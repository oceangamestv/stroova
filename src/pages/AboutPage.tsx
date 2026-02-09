import React from "react";
import Header from "../components/common/Header";

const TelegramIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    width="20"
    height="20"
  >
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161l-1.97 9.272c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z" />
  </svg>
);

const BoostyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    width="20"
    height="20"
  >
    <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
  </svg>
);

const AboutPage: React.FC = () => {
  return (
    <div className="app-shell">
      <Header />
      <main className="main">
        <section className="lesson-card">
          <div style={{ 
            position: "relative",
            marginBottom: "0.5rem",
            paddingBottom: "0.25rem"
          }}>
            <h1 style={{
              fontSize: "clamp(2rem, 5vw, 3rem)",
              fontWeight: "900",
              background: "linear-gradient(135deg, #ffc107 0%, #2196f3 50%, #ffc107 100%)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              animation: "gradient-shift 3s ease infinite",
              marginBottom: "0.25rem",
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
            }}>
              О проекте
            </h1>
            <div style={{
              width: "80px",
              height: "4px",
              background: "linear-gradient(90deg, #ffc107, #2196f3)",
              borderRadius: "2px",
              marginTop: "0.25rem",
            }} />
            <style>{`
              @keyframes gradient-shift {
                0%, 100% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
              }
              @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-10px); }
              }
              @keyframes glow {
                0%, 100% { box-shadow: 0 0 20px rgba(255, 193, 7, 0.3), 0 0 40px rgba(33, 150, 243, 0.2); }
                50% { box-shadow: 0 0 30px rgba(255, 193, 7, 0.5), 0 0 60px rgba(33, 150, 243, 0.3); }
              }
            `}</style>
          </div>

          <div style={{ padding: "0.5rem 0" }}>
            <p style={{ 
              fontSize: "1.15rem", 
              lineHeight: "1.8", 
              marginBottom: "1rem",
              marginTop: "0.5rem",
              color: "var(--text)",
              fontWeight: "400",
              textAlign: "justify",
            }}>
              <span style={{
                fontSize: "1.3em",
                fontWeight: "700",
                background: "linear-gradient(135deg, #ffc107, #ffb300)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>Stroova</span> — это <strong style={{ color: "var(--accent)" }}>бесплатный проект</strong> для практики английского языка, 
              который постоянно развивается и дополняется новыми функциями.
            </p>
            <p style={{ 
              fontSize: "1.15rem", 
              lineHeight: "1.8", 
              marginBottom: "2rem",
              color: "var(--text)",
              fontWeight: "400",
              textAlign: "justify",
            }}>
              Здесь вы найдёте интерактивные игры, 
              словарь с прогрессом изучения и множество возможностей для улучшения своих навыков.
            </p>
            
            <div style={{ 
              marginTop: "2.5rem", 
              padding: "2rem", 
              background: "linear-gradient(135deg, rgba(33, 150, 243, 0.08) 0%, rgba(33, 150, 243, 0.03) 100%)",
              borderRadius: "16px",
              border: "2px solid rgba(33, 150, 243, 0.2)",
              position: "relative",
              overflow: "hidden",
              transition: "all 0.3s ease",
              boxShadow: "0 4px 20px rgba(33, 150, 243, 0.1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.boxShadow = "0 8px 30px rgba(33, 150, 243, 0.2)";
              e.currentTarget.style.borderColor = "rgba(33, 150, 243, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(33, 150, 243, 0.1)";
              e.currentTarget.style.borderColor = "rgba(33, 150, 243, 0.2)";
            }}
            >
              <div style={{
                position: "absolute",
                top: "-60%",
                right: "-25%",
                width: "200px",
                height: "200px",
                background: "radial-gradient(circle, rgba(33, 150, 243, 0.1) 0%, transparent 70%)",
                borderRadius: "50%",
                animation: "float 6s ease-in-out infinite",
                pointerEvents: "none",
                zIndex: 0,
              }} />
              <div style={{ position: "relative", zIndex: 10 }}>
                <h2 style={{ 
                  marginTop: "0", 
                  marginBottom: "1rem", 
                  fontSize: "1.5rem",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  color: "var(--text)",
                  position: "relative",
                  zIndex: 10,
                }}>
                  <span style={{ fontSize: "1.8rem", position: "relative", zIndex: 10 }}>📢</span>
                  <span style={{
                    background: "linear-gradient(135deg, #2196f3, #1976d2)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    position: "relative",
                    zIndex: 10,
                  }}>Следите за новостями</span>
                </h2>
                <p style={{ 
                  marginBottom: "1.5rem",
                  fontSize: "1.05rem",
                  lineHeight: "1.7",
                  color: "var(--text-soft)",
                  position: "relative",
                  zIndex: 10,
                }}>
                  Хотите быть в курсе всех обновлений и новых функций? Присоединяйтесь к нашему сообществу!
                </p>
                <a
                  href="https://t.me/stroova"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    color: "#ffffff",
                    textDecoration: "none",
                    fontWeight: "600",
                    padding: "0.875rem 1.75rem",
                    borderRadius: "12px",
                    background: "linear-gradient(135deg, #2196f3 0%, #1976d2 100%)",
                    border: "none",
                    transition: "all 0.3s ease",
                    boxShadow: "0 4px 15px rgba(33, 150, 243, 0.3)",
                    position: "relative",
                    overflow: "hidden",
                    zIndex: 10,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px) scale(1.02)";
                    e.currentTarget.style.boxShadow = "0 6px 25px rgba(33, 150, 243, 0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0) scale(1)";
                    e.currentTarget.style.boxShadow = "0 4px 15px rgba(33, 150, 243, 0.3)";
                  }}
                >
                  <TelegramIcon style={{ width: "22px", height: "22px", filter: "brightness(0) invert(1)" }} />
                  <span>Telegram канал Stroova</span>
                </a>
              </div>
            </div>

            <div style={{ 
              marginTop: "2rem", 
              padding: "2rem", 
              background: "linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 179, 0, 0.05) 100%)",
              borderRadius: "16px",
              border: "2px solid rgba(255, 193, 7, 0.3)",
              position: "relative",
              overflow: "hidden",
              transition: "all 0.3s ease",
              boxShadow: "0 4px 20px rgba(255, 193, 7, 0.15)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.boxShadow = "0 8px 30px rgba(255, 193, 7, 0.25)";
              e.currentTarget.style.borderColor = "rgba(255, 193, 7, 0.5)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(255, 193, 7, 0.15)";
              e.currentTarget.style.borderColor = "rgba(255, 193, 7, 0.3)";
            }}
            >
              <div style={{
                position: "absolute",
                bottom: "-30%",
                left: "-10%",
                width: "180px",
                height: "180px",
                background: "radial-gradient(circle, rgba(255, 193, 7, 0.2) 0%, transparent 70%)",
                borderRadius: "50%",
                animation: "float 8s ease-in-out infinite",
                pointerEvents: "none",
              }} />
              <div style={{ position: "relative", zIndex: 1 }}>
                <h2 style={{ 
                  marginTop: "0", 
                  marginBottom: "1rem", 
                  fontSize: "1.5rem",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  color: "var(--text)",
                }}>
                  <span style={{ fontSize: "1.8rem" }}>💚</span>
                  <span style={{
                    background: "linear-gradient(135deg, #ffc107, #ffb300)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}>Поддержите проект</span>
                </h2>
                <p style={{ 
                  marginBottom: "1.5rem",
                  fontSize: "1.05rem",
                  lineHeight: "1.7",
                  color: "var(--text-soft)",
                }}>
                  Если вам нравится Stroova и вы хотите помочь проекту развиваться дальше, 
                  вы можете поддержать нас на Boosty. Ваше имя будет вписано в историю злодеев проекта! 😈
                </p>
                <a
                  href="https://boosty.to/stroova"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    color: "#000000",
                    textDecoration: "none",
                    fontWeight: "600",
                    padding: "0.875rem 1.75rem",
                    borderRadius: "12px",
                    background: "linear-gradient(135deg, #ffc107 0%, #ffb300 100%)",
                    border: "none",
                    transition: "all 0.3s ease",
                    boxShadow: "0 4px 15px rgba(255, 193, 7, 0.4)",
                    position: "relative",
                    overflow: "hidden",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px) scale(1.02)";
                    e.currentTarget.style.boxShadow = "0 6px 25px rgba(255, 193, 7, 0.5)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0) scale(1)";
                    e.currentTarget.style.boxShadow = "0 4px 15px rgba(255, 193, 7, 0.4)";
                  }}
                >
                  <BoostyIcon style={{ width: "22px", height: "22px" }} />
                  <span>Поддержать на Boosty</span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default AboutPage;
