import React from "react";
import { Link } from "react-router-dom";
import Header from "../components/common/Header";
import { useIsMobile } from "../hooks/useIsMobile";

const PrivacyPolicyPage: React.FC = () => {
  const isMobile = useIsMobile();
  return (
    <div className="app-shell">
      <Header />
      <main className="main">
        <div className={isMobile ? undefined : "page-card"}>
          <section className="lesson-card">
            <div
              style={{
                position: "relative",
                marginBottom: "0.5rem",
                paddingBottom: "0.25rem",
              }}
            >
              <h1
                style={{
                  fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
                  fontWeight: "800",
                  color: "var(--text)",
                  marginBottom: "0.25rem",
                  letterSpacing: "-0.02em",
                }}
              >
                Политика конфиденциальности
              </h1>
              <div
                style={{
                  width: "80px",
                  height: "4px",
                  background: "var(--accent)",
                  borderRadius: "2px",
                  marginTop: "0.25rem",
                }}
              />
            </div>

            <div style={{ padding: "0.5rem 0", color: "var(--text)", lineHeight: "1.75" }}>
              <p style={{ marginBottom: "0.75rem", color: "var(--text-soft)" }}>
                Редакция от: 16 февраля 2026 г.
              </p>
              <p style={{ marginBottom: "1rem" }}>
                Настоящая Политика конфиденциальности (далее — «Политика») описывает, какие данные обрабатываются при использовании сервиса STroova (далее — «Сервис»), и как с нами
                связаться.
              </p>
              <p style={{ marginBottom: "1rem" }}>
                <b>Оператор/Администратор:</b> Михаил Тадосов (физическое лицо).<br />
                <b>Контакт:</b>{" "}
                <a href="mailto:tadosov@mail.ru" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                  tadosov@mail.ru
                </a>
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>1) Какие данные мы обрабатываем</h2>
              <p style={{ marginBottom: "1rem" }}>
                Сервис не предназначен для сбора персональных данных и не запрашивает ФИО, дату рождения, адрес, телефон, e‑mail и иные персональные данные.
              </p>
              <p style={{ marginBottom: "0.5rem" }}>
                Для работы Сервиса могут обрабатываться минимально необходимые технические и учётные данные, в том числе:
              </p>
              <ul style={{ marginTop: 0, marginBottom: "1rem", paddingLeft: "1.25rem" }}>
                <li>
                  <b>логин (username)</b> — идентификатор учётной записи (может отображаться публично в рейтингах/таблицах лидеров);
                </li>
                <li>
                  <b>пароль</b> — в Сервисе хранится не пароль, а его защищённое значение (например, хэш);
                </li>
                <li>
                  <b>технические данные сессии</b> (например, токен/идентификатор входа, время входа) — для авторизации;
                </li>
                <li>
                  <b>данные прогресса/настроек</b> внутри Сервиса (например, результаты упражнений, словарный прогресс) — чтобы работал функционал.
                </li>
              </ul>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>2) Запрет на ввод персональных данных</h2>
              <p style={{ marginBottom: "1rem" }}>
                Пользователь обязуется не указывать персональные данные (в т.ч. ФИО и любые сведения, позволяющие идентифицировать личность) в логине и любых полях Сервиса. При
                нарушении этого правила мы вправе заблокировать учётную запись и принять меры по удалению таких данных в объёме, необходимом для прекращения нарушения и защиты
                Сервиса.
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>3) Цели обработки</h2>
              <ul style={{ marginTop: 0, marginBottom: "1rem", paddingLeft: "1.25rem" }}>
                <li>регистрация и вход в Сервис;</li>
                <li>предоставление функций Сервиса (прогресс, рейтинги и т. п.);</li>
                <li>обеспечение безопасности и работоспособности (защита от злоупотреблений, диагностика сбоев).</li>
              </ul>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>4) Основания обработки</h2>
              <p style={{ marginBottom: "1rem" }}>
                Обработка осуществляется в связи с использованием Сервиса и выполнением условий пользовательского соглашения, а также на основании согласия Пользователя,
                выраженного действиями по использованию Сервиса (регистрация/вход/использование функций), в объёме, необходимом для его работы.
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>5) Cookies и аналитика</h2>
              <p style={{ marginBottom: "1rem" }}>
                Мы не используем аналитические и рекламные cookies и не ведём маркетинговое профилирование. При этом могут применяться строго необходимые технические механизмы
                хранения (например, токен авторизации в браузере) для работы входа и сессий.
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>6) Передача третьим лицам</h2>
              <p style={{ marginBottom: "1rem" }}>
                Мы не продаём и не передаём данные Пользователей третьим лицам для маркетинга. Исключения: если это необходимо для работы инфраструктуры (например, хостинг/серверные
                платформы) в объёме, требуемом для оказания услуги.
              </p>
              <p style={{ marginBottom: "1rem" }}>
                Если Пользователь делает пожертвование через сторонний платёжный сервис, платёжные данные обрабатываются соответствующим платёжным сервисом по его правилам. Сервис
                STroova не получает и не хранит реквизиты банковских карт.
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>7) Сроки хранения</h2>
              <p style={{ marginBottom: "1rem" }}>
                Данные учётной записи и прогресса хранятся, пока существует учётная запись и/или пока это необходимо для работы Сервиса. Технические данные сессий могут храниться
                ограниченное время для обеспечения авторизации и безопасности.
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>8) Безопасность</h2>
              <p style={{ marginBottom: "1rem" }}>
                Мы принимаем разумные технические и организационные меры для защиты данных от несанкционированного доступа (включая хранение пароля в виде защищённого значения и
                ограничения на попытки входа).
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>9) Права пользователя и обращения</h2>
              <p style={{ marginBottom: "1rem" }}>
                Пользователь может обратиться по адресу{" "}
                <a href="mailto:tadosov@mail.ru" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                  tadosov@mail.ru
                </a>{" "}
                с запросом: уточнить, какие данные связаны с его учётной записью; удалить учётную запись (и связанные с ней данные) — по возможности и в пределах требований
                безопасности/закона. В обращении укажите ваш логин (username) и суть запроса. Срок ответа — до 10 календарных дней.
              </p>

              <h2 style={{ fontSize: "1.25rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>10) Изменения политики</h2>
              <p style={{ marginBottom: "1rem" }}>
                Мы можем обновлять Политику. Актуальная версия публикуется в Сервисе. Продолжение использования Сервиса после обновления означает согласие с новой редакцией.
              </p>

              <p style={{ marginTop: "1.5rem" }}>
                <Link to="/login" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                  ← Вернуться к входу
                </Link>
              </p>
            </div>
          </section>
        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default PrivacyPolicyPage;

