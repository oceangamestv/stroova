-- Активные дни и награды
-- Применение: psql -U stroova -d stroova -f server/migrations/003_active_days_and_rewards.sql

-- Награды: тип награды и конфиг (xp, в будущем — достижения и т.д.)
CREATE TABLE IF NOT EXISTS rewards (
  id SERIAL PRIMARY KEY,
  reward_key VARCHAR(100) UNIQUE NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT ''
);

-- Одна запись на пользователя: последняя активная дата и текущая серия дней
CREATE TABLE IF NOT EXISTS user_active_days (
  username VARCHAR(255) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
  last_active_date DATE,
  streak_days INT NOT NULL DEFAULT 0
);

-- Награда за активный день: 10 XP (потом можно добавить достижения)
INSERT INTO rewards (reward_key, config, description)
VALUES ('active_day', '{"xp": 10}', '10 XP за активный день')
ON CONFLICT (reward_key) DO NOTHING;

COMMENT ON TABLE rewards IS 'Награды по ключу: active_day, в будущем — достижения';
COMMENT ON TABLE user_active_days IS 'Активные дни: дата последней активности и длина серии (сбрасывается при пропуске дня)';
