import React, { useCallback, useEffect, useState } from "react";
import Header from "../components/common/Header";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuth } from "../features/auth/AuthContext";
import { ratingApi } from "../api/endpoints";
import { formatXp } from "../domain/xp";
import type { LeaderboardPeriod } from "../api/types";

const PERIODS = ["day", "week", "all"] as const;
type PeriodKey = (typeof PERIODS)[number];

const PERIOD_LABELS: Record<PeriodKey, string> = {
  day: "Сегодня",
  week: "За неделю",
  all: "Всего",
};

function LeaderboardTable({
  data,
  currentUsername,
  period,
}: {
  data: LeaderboardPeriod;
  currentUsername: string | null;
  period: PeriodKey;
}) {
  const { items, currentUser } = data;
  // Не показываем currentUser, если у него XP = 0
  const shouldShowCurrentUser = currentUser && currentUser.rank > 10 && currentUser.xp > 0;
  const isEmpty = items.length === 0 && !shouldShowCurrentUser;
  const showEmptyMessage = isEmpty && (period === "day" || period === "week");

  const cellLabels = { rank: "Место", name: "Участник", level: "Уровень", streak: "🔥", xp: "XP" };

  if (showEmptyMessage) {
    return (
      <div className="rating-table-wrapper">
        <p className="rating-empty-message">Пока тут нет чемпионов</p>
      </div>
    );
  }

  return (
    <div className="rating-table-wrapper">
      <table className="rating-table">
        <thead>
          <tr>
            <th className="rating-col-rank" scope="col">Место</th>
            <th className="rating-col-name" scope="col">Участник</th>
            <th className="rating-col-level" scope="col">Уровень</th>
            <th className="rating-col-streak" scope="col" aria-label="Макс. страйк">🔥</th>
            <th className="rating-col-xp" scope="col">XP</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr
              key={entry.username}
              className={`rating-row ${entry.rank <= 3 ? `rating-podium rating-podium-${entry.rank}` : ""} ${currentUsername && entry.username === currentUsername ? "rating-row--you" : ""}`}
            >
              <td className="rating-col-rank" data-label={cellLabels.rank}>
                <span className="rating-rank">{entry.rank}</span>
              </td>
              <td className="rating-col-name" data-label={cellLabels.name}>{entry.displayName}</td>
              <td className="rating-col-level" data-label={cellLabels.level}>{entry.level}</td>
              <td className="rating-col-streak" data-label={cellLabels.streak}>{entry.maxStreak}</td>
              <td className="rating-col-xp" data-label={cellLabels.xp}>{formatXp(entry.xp)}</td>
            </tr>
          ))}
          {shouldShowCurrentUser && currentUser && (
            <tr className="rating-row rating-row--below-top rating-row--you">
              <td className="rating-col-rank" data-label={cellLabels.rank}>
                <span className="rating-rank">{currentUser.rank}</span>
              </td>
              <td className="rating-col-name" data-label={cellLabels.name}>
                {currentUser.displayName}
                <span className="rating-your-place"> — ваше место</span>
              </td>
              <td className="rating-col-level" data-label={cellLabels.level}>{currentUser.level}</td>
              <td className="rating-col-streak" data-label={cellLabels.streak}>{currentUser.maxStreak}</td>
              <td className="rating-col-xp" data-label={cellLabels.xp}>{formatXp(currentUser.xp)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const RatingsPage: React.FC = () => {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [data, setData] = useState<{
    day: LeaderboardPeriod;
    week: LeaderboardPeriod;
    all: LeaderboardPeriod;
    participating: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ratingApi.getLeaderboard();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить рейтинг");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [period, setPeriod] = useState<PeriodKey>("day");
  const currentData = data ? data[period] : null;

  return (
    <div className="app-shell">
      <Header />
      <main className="main main--top">
        <div className={isMobile ? "rating-page-wrap" : "page-card"}>
          <div className="rating-page">
            <h1 className="rating-page-title">Рейтинг</h1>

          {!user && (
            <p className="rating-login-hint">
              Войдите в аккаунт, чтобы участвовать в рейтинге и видеть своё место.
            </p>
          )}

          {error && <p className="rating-error">{error}</p>}

          {loading ? (
            <p className="rating-loading">Загрузка рейтинга…</p>
          ) : data ? (
            <section className="rating-block">
              <div className="rating-tabs" role="tablist" aria-label="Период рейтинга">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={period === p}
                    className={`rating-tab ${period === p ? "rating-tab--active" : ""}`}
                    onClick={() => setPeriod(p)}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
              <LeaderboardTable
                data={currentData!}
                currentUsername={user?.username ?? null}
                period={period}
              />
            </section>
          ) : null}
          </div>
        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default RatingsPage;
