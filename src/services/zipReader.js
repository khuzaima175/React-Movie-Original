export const ZIP_LIMITS = Object.freeze({
  maxEntries: 200,
  maxUncompressedBytes: 25 * 1024 * 1024
});

const EOCD_SIG = 0x06054b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const LOCAL_HEADER_SIG = 0x04034b50;

function findEocdOffset(view, byteLength) {
  const minOffset = Math.max(0, byteLength - 22 - 65535);
  for (let i = byteLength - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      return i;
    }
  }
  return -1;
}

function validateSafeEntryPath(rawPath) {
  const normalized = String(rawPath || "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/")) {
    throw new Error(`Unsafe path in ZIP archive: ${normalized}`);
  }
  const segments = normalized.split("/");
  if (segments.some((seg) => seg === "..")) {
    throw new Error(`Unsafe path in ZIP archive: ${normalized}`);
  }
  return normalized;
}

async function inflateDeflateRaw(compressedBytes, maxBytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("ZIP deflate decompression is not supported in this runtime.");
  }

  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("ZIP archive exceeds uncompressed size limit.");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Extracts UTF-8 text files from a ZIP ArrayBuffer without external dependencies.
 * Supports Stored (method 0) and Deflate (method 8) while enforcing entry count,
 * uncompressed size, and path-traversal limits.
 */
export async function extractZipTextFiles(arrayBuffer, options = {}) {
  const maxEntries = Number(options.maxEntries) || ZIP_LIMITS.maxEntries;
  const maxUncompressedBytes = Number(options.maxUncompressedBytes) || ZIP_LIMITS.maxUncompressedBytes;

  if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer || ArrayBuffer.isView(arrayBuffer))) {
    throw new Error("Invalid ZIP input buffer.");
  }

  const bytes = arrayBuffer instanceof ArrayBuffer
    ? new Uint8Array(arrayBuffer)
    : new Uint8Array(arrayBuffer.buffer, arrayBuffer.byteOffset, arrayBuffer.byteLength);

  if (bytes.byteLength < 22) {
    throw new Error("ZIP archive is truncated or empty.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(view, bytes.byteLength);
  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: missing End of Central Directory.");
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  if (entryCount > maxEntries) {
    throw new Error(`ZIP archive exceeds entry limit (${maxEntries} max).`);
  }

  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (cdOffset + cdSize > bytes.byteLength) {
    throw new Error("Invalid ZIP archive: central directory out of bounds.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const files = new Map();
  let cursor = cdOffset;
  let totalDeclaredUncompressed = 0;
  let totalActualUncompressed = 0;

  const cdEnd = cdOffset + cdSize;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > cdEnd || cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== CENTRAL_DIR_SIG) {
      throw new Error("Invalid ZIP archive: corrupt central directory header.");
    }

    const generalPurposeFlag = view.getUint16(cursor + 8, true);
    if ((generalPurposeFlag & 1) !== 0) {
      throw new Error("Encrypted ZIP archives are not supported.");
    }

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (cursor + 46 + nameLen + extraLen + commentLen > cdEnd) {
      throw new Error("Invalid ZIP archive: central directory entry out of bounds.");
    }

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLen);
    const entryName = validateSafeEntryPath(decoder.decode(nameBytes));
    cursor += 46 + nameLen + extraLen + commentLen;

    totalDeclaredUncompressed += uncompressedSize;
    if (totalDeclaredUncompressed > maxUncompressedBytes) {
      throw new Error("ZIP archive exceeds uncompressed size limit.");
    }

    if (entryName.endsWith("/")) {
      continue;
    }

    if (localHeaderOffset + 30 > bytes.byteLength || view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIG) {
      throw new Error(`Invalid local header for ZIP entry: ${entryName}`);
    }

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) {
      throw new Error(`Corrupt compressed payload for ZIP entry: ${entryName}`);
    }

    const compressedSlice = bytes.subarray(dataStart, dataEnd);
    let plainBytes;
    if (method === 0) {
      plainBytes = compressedSlice;
    } else if (method === 8) {
      const remainingBudget = maxUncompressedBytes - totalActualUncompressed;
      plainBytes = await inflateDeflateRaw(compressedSlice, remainingBudget);
    } else {
      throw new Error(`Unsupported ZIP compression method (${method}) for ${entryName}.`);
    }

    totalActualUncompressed += plainBytes.byteLength;
    if (totalActualUncompressed > maxUncompressedBytes) {
      throw new Error("ZIP archive exceeds uncompressed size limit.");
    }

    files.set(entryName, decoder.decode(plainBytes));
  }

  return files;
}
