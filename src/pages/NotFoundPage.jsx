import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Film, Home, Compass } from "lucide-react";
import { EASE, riseIn, staggerContainer } from "../motion";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className="notfound-page page-rail">
      <motion.div
        className="notfound-inner"
        variants={staggerContainer(0.09, 0.05)}
        initial="hidden"
        animate="show"
      >
        <motion.div className="notfound-reel" variants={riseIn} aria-hidden="true">
          <Film size={34} />
        </motion.div>
        <motion.p className="notfound-code tabular-num" variants={riseIn}>
          404
        </motion.p>
        <motion.h1 className="notfound-title display-title" variants={riseIn}>
          This scene was cut from the final edit.
        </motion.h1>
        <motion.p className="notfound-copy" variants={riseIn}>
          The page you're looking for doesn't exist or has moved.
        </motion.p>
        <motion.div className="notfound-actions" variants={riseIn} transition={{ ease: EASE }}>
          <Link to="/" className="btn-hero-primary">
            <Home size={16} aria-hidden="true" /> Back to Discover
          </Link>
          <Link to="/explore" className="btn-hero-secondary">
            <Compass size={16} aria-hidden="true" /> Explore films
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
