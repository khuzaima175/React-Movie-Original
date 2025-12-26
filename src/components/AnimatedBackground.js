import { motion } from "framer-motion";

const particles = [
    { emoji: "🎬", size: 2.4, duration: 20, delay: 0 },
    { emoji: "⭐", size: 1.8, duration: 25, delay: 2 },
    { emoji: "🎥", size: 2.2, duration: 22, delay: 4 },
    { emoji: "🍿", size: 2.0, duration: 18, delay: 1 },
    { emoji: "🎞️", size: 1.6, duration: 24, delay: 3 },
    { emoji: "🌟", size: 1.4, duration: 28, delay: 5 },
    { emoji: "🎭", size: 2.0, duration: 21, delay: 2.5 },
    { emoji: "📽️", size: 1.8, duration: 26, delay: 4.5 },
];

export default function AnimatedBackground() {
    return (
        <div className="animated-bg">
            {/* Gradient orbs */}
            <div className="gradient-orb orb-1"></div>
            <div className="gradient-orb orb-2"></div>
            <div className="gradient-orb orb-3"></div>

            {/* Floating particles */}
            {particles.map((particle, index) => (
                <motion.div
                    key={index}
                    className="floating-particle"
                    style={{
                        fontSize: `${particle.size}rem`,
                        left: `${10 + (index * 12) % 80}%`,
                    }}
                    initial={{
                        y: "100vh",
                        opacity: 0,
                        rotate: 0
                    }}
                    animate={{
                        y: "-100vh",
                        opacity: [0, 0.6, 0.6, 0],
                        rotate: 360
                    }}
                    transition={{
                        duration: particle.duration,
                        delay: particle.delay,
                        repeat: Infinity,
                        ease: "linear"
                    }}
                >
                    {particle.emoji}
                </motion.div>
            ))}

            {/* Grid pattern overlay */}
            <div className="grid-pattern"></div>
        </div>
    );
}
