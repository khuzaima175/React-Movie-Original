import { useState, useRef, useEffect } from "react";
import { sendChatMessage } from "../services/geminiChatService";

export default function AIChat({ watched }) {
    const [messages, setMessages] = useState([
        { role: "model", text: "Hello! I've analyzed your movie history. Ask me for a recommendation or let's discuss your favorite directors! 🎬" }
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const chatContainerRef = useRef(null);

    // Scroll to bottom using scrollTop to avoid page-level scroll jumps
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;

        const userMsg = input.trim();
        setInput("");

        // Add user message immediately
        const newMessages = [...messages, { role: "user", text: userMsg }];
        setMessages(newMessages);
        setIsLoading(true);

        try {
            // Get AI response (exclude the initial greeting from history sent to API to avoid duplication logic issues if needed, strictly speaking the service handles the system prompt)
            // We pass the conversation history excluding the current new message which is handled by the service
            // The service builds the system prompt fresh each time, so we just pass the user/model conversation.

            const responseText = await sendChatMessage(userMsg, newMessages.filter(m => m !== newMessages[0]), watched);

            setMessages(prev => [...prev, { role: "model", text: responseText }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: "model", text: "⚠️ Connection error. Please try again." }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="ai-chat-container">
            <div className="chat-messages" ref={chatContainerRef}>
                {messages.map((msg, index) => (
                    <div key={index} className={`chat-bubble ${msg.role}`}>
                        <div className="bubble-content">
                            {msg.role === "model" && <span className="chat-icon">🤖</span>}
                            <p>{msg.text}</p>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="chat-bubble model">
                        <div className="bubble-content">
                            <span className="chat-icon">🤖</span>
                            <div className="typing-indicator">
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <form className="chat-input-area" onSubmit={handleSend}>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about movies, recommendations, or directors..."
                    disabled={isLoading}
                />
                <button type="submit" disabled={isLoading || !input.trim()}>
                    ➤
                </button>
            </form>
        </div>
    );
}
