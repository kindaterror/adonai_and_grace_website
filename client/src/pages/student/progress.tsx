import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Clock,
  BarChart3,
  ChevronRight,
  ChevronLeft,
  ArrowUpRight,
  TrendingUp,
  GraduationCap,
  Target,
  Star,
  Loader2,
  Award,
  Sparkles,
  Moon,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ✅ badge API helper (normalizes server response shapes)
import { listUserBadges } from "@/pages/api/badges";

/* ----------------------------- Types ----------------------------- */
type QuizAttempt = {
  userId: number;
  bookId: number;
  pageId?: number | null;
  scoreCorrect?: number | null;
  scoreTotal?: number | null;
  percentage?: number | null;
  mode?: "retry" | "straight" | string;
  attemptNumber?: number | null;
  durationSec?: number | null;
  createdAt?: string;
};

type QuizSession = {
  bookId: number;
  startAt: number;
  endAt: number;
  totalCorrect: number;
  totalTotal: number;
  percentage: number;
  mode: "retry" | "straight";
};

type EarnedBadge = {
  id: number;
  userId: number;
  badgeId: number;
  bookId?: number | null;
  awardedAt?: string;
  note?: string | null;
  badge?: {
    id: number;
    name: string;
    description?: string | null;
    iconUrl?: string | null;
    iconPublicId?: string | null;
  };
  book?: {
    id: number;
    title?: string;
    coverImage?: string | null;
    coverPublicId?: string | null;
  };
};

const SESSION_GAP_SEC = 120;

/* ===========================================================
   EXCLUSIVE STORY ROUTING (title → slug)
=========================================================== */
const EXCLUSIVE_TITLE_TO_SLUG: Record<string, string> = {
  "The Necklace and the Comb": "necklace-comb",
  "The Sun and the Moon": "sun-moon",           // safe to keep mapping for future
  "Bernardo Carpio": "bernardo-carpio",          // safe to keep mapping for future
};

/* ===========================================================
   EXCLUSIVE BADGE NAMES (must match seed exactly)
=========================================================== */
const EXCLUSIVE_BADGE_NAMES = new Set<string>([
  "Necklace & Comb Finisher",
  "Sun & Moon Finisher",
  "Bernardo Carpio Finisher",
]);

const isExclusiveBadge = (b?: EarnedBadge) =>
  !!b?.badge?.name && EXCLUSIVE_BADGE_NAMES.has(b.badge.name);

function getReadingUrl(progress: any) {
  const bookId: number | undefined = progress?.book?.id ?? progress?.bookId;
  const title: string | undefined = progress?.book?.title ?? progress?.title;

  // 🔗 Match your App routes: /student/read-twodanimation/:slug
  if (title && EXCLUSIVE_TITLE_TO_SLUG[title]) {
    const slug = EXCLUSIVE_TITLE_TO_SLUG[title];
    return `/student/read-twodanimation/${slug}`;
  }

  if (bookId) {
    const isEducational =
      (progress?.book?.type ?? progress?.type) === "educational";
    return isEducational
      ? `/student/educational-books/${bookId}`
      : `/student/storybooks/${bookId}`;
  }
  return "/student";
}

/* ============================ Component ============================ */
export default function StudentProgress() {
  const [activeTab, setActiveTab] = useState("overview");

  const formatSubject = (subject: string) => {
    if (!subject) return null;
    const map: Record<string, string> = {
      "filipino-literature": "📚 Filipino Literature",
      "philippine-folklore": "🏛️ Philippine Folklore",
      "reading-comprehension": "📖 Reading Comprehension",
      "creative-writing": "✍️ Creative Writing",
      "general-education": "🎓 General Education",
    };
    return map[subject] || subject;
  };

  /* ----------------------------- Queries ----------------------------- */
  const { data: progressData, isLoading } = useQuery({
    queryKey: ["/api/progress"],
    queryFn: async () => {
      const response = await fetch("/api/progress", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!response.ok) throw new Error("Failed to fetch progress");
      return response.json();
    },
  });

  const { data: quizAttemptsData } = useQuery({
    queryKey: ["/api/quiz-attempts"],
    queryFn: async () => {
      const res = await fetch("/api/quiz-attempts", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch quiz attempts");
      return res.json();
    },
  });

  // --- Earned Badges (helper + resilient fallbacks) ---
  const {
    data: earnedBadgesPayload,
    isLoading: badgesLoading,
    error: badgesError,
  } = useQuery({
    queryKey: ["earned-badges"],
    enabled: !!localStorage.getItem("token"),
    queryFn: async () => {
      const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };

      // Who am I? try a few endpoints you already have
      const tryFetch = async (url: string) => {
        const r = await fetch(url, { headers });
        if (!r.ok) return null;
        const j = await r.json();
        return j?.user ?? j;
      };

      const me =
        (await tryFetch("/api/user/me")) ??
        (await tryFetch("/api/auth/user")) ??
        (await tryFetch("/api/users/me"));

      if (!me?.id) throw new Error("No user id found");

      // use the shared helper → it normalizes {badges|earnedBadges|[]}
      const list = await listUserBadges(me.id);
      return Array.isArray(list) ? list : [];
    },
  });

  const allEarnedBadges: EarnedBadge[] = Array.isArray(earnedBadgesPayload)
    ? earnedBadgesPayload
    : [];

  // 🔎 Split out exclusive vs generic/other
  const exclusiveEarned = allEarnedBadges.filter(isExclusiveBadge);
  const otherEarned = allEarnedBadges.filter((b) => !isExclusiveBadge(b));

  /* ----------------------------- Helpers ----------------------------- */
  const getUniqueProgress = (arr: any[]) => {
    if (!arr) return [];
    return arr.reduce((unique: any[], p: any) => {
      const i = unique.findIndex((x) => x.bookId === p.bookId);
      if (i === -1) unique.push(p);
      else if (new Date(p.lastReadAt) > new Date(unique[i].lastReadAt)) unique[i] = p;
      return unique;
    }, []);
  };

  const formatReadingTime = (totalSeconds: number) => {
    if (!totalSeconds || totalSeconds === 0) return "0:00:00";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString() : "—";

  // Cloudinary env (supports Next/Vite)
  const CLOUD =
    import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ||
    import.meta.env.VITE_PUBLIC_CLOUDINARY_CLOUD_NAME ||
    (typeof process !== "undefined"
      ? (process as any).env?.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
      : undefined);

  const getBadgeIconUrl = (badge: any, w = 64) => {
    if (!badge) return null;
    const direct = badge.iconUrl ?? badge.icon_url ?? null;
    if (direct) return direct;
    const publicId = badge.iconPublicId ?? badge.icon_public_id ?? null;
    if (publicId && CLOUD) {
      return `https://res.cloudinary.com/${CLOUD}/image/upload/c_fill,w=${w},h=${w},q_auto,f_auto/${publicId}`;
    }
    return null;
  };

  // Book title map for badges that only have bookId
  const bookTitleById = useMemo(() => {
    const map = new Map<number, string>();
    const all = progressData?.progress ?? [];
    for (const p of all) {
      const bid = p.book?.id ?? p.bookId;
      const title = p.book?.title;
      if (bid && title) map.set(bid, title);
    }
    return map;
  }, [progressData]);

  const attempts = (quizAttemptsData?.attempts || []) as QuizAttempt[];
  const ts = (a: QuizAttempt) => (a.createdAt ? new Date(a.createdAt).getTime() : 0);

  const groupIntoSessions = (list: QuizAttempt[], gapSec = SESSION_GAP_SEC): QuizSession[] => {
    const out: QuizSession[] = [];
    let cur: QuizSession | null = null;
    for (const a of list) {
      const time = ts(a);
      const corr = Number(a.scoreCorrect ?? 0);
      const tot = Number(a.scoreTotal ?? 0);
      const mode = a.mode === "straight" ? "straight" : "retry";
      if (!cur || time - cur.endAt > gapSec * 1000) {
        cur = {
          bookId: a.bookId,
          startAt: time,
          endAt: time,
          totalCorrect: 0,
          totalTotal: 0,
          percentage: 0,
          mode,
        };
        out.push(cur);
      } else {
        cur.endAt = time;
      }
      cur.totalCorrect += corr;
      cur.totalTotal += tot;
      cur.percentage =
        cur.totalTotal > 0 ? Math.round((cur.totalCorrect / cur.totalTotal) * 100) : 0;
      if (mode === "straight") cur.mode = "straight";
    }
    return out;
  };

  const sessionsForBook = (bookId: number) => {
    const list = attempts.filter((a) => a.bookId === bookId).sort((a, b) => ts(a) - ts(b));
    return groupIntoSessions(list);
  };

  const latestQuizForBook = (bookId: number) => {
    const sessions = sessionsForBook(bookId);
    return sessions.length ? sessions[sessions.length - 1] : null;
  };

  const averageQuizAcrossSessions = () => {
    const byKey = new Map<string, QuizAttempt[]>();
    for (const a of attempts) {
      const key = `${a.userId}:${a.bookId}`;
      const arr = byKey.get(key) ?? [];
      arr.push(a);
      byKey.set(key, arr);
    }
    const sessions: QuizSession[] = [];
    byKey.forEach((arr) => {
      const sorted = arr.slice().sort((a: QuizAttempt, b: QuizAttempt) => ts(a) - ts(b));
      sessions.push(...groupIntoSessions(sorted));
    });
    if (sessions.length === 0) return null;
    const sum = sessions.reduce((s, x) => s + x.percentage, 0);
    return Math.round(sum / sessions.length);
  };

  const quizBadgeClass = (pct: number) =>
    pct >= 80
      ? "border-green-400 text-green-700"
      : pct >= 50
      ? "border-amber-400 text-amber-700"
      : "border-red-400 text-red-700";

  /* ----------------------------- Reading stats ----------------------------- */
  const getStats = () => {
    if (!progressData?.progress) {
      return { booksCompleted: 0, booksInProgress: 0, totalReadingTime: 0, completionRate: 0 };
    }
    const unique = getUniqueProgress(progressData.progress);
    const completed = unique.filter((p: any) => p.percentComplete === 100).length;
    const inProgress = unique.filter((p: any) => p.percentComplete > 0 && p.percentComplete < 100)
      .length;
    const totalSeconds = unique.reduce(
      (sum: number, p: any) => sum + (p.totalReadingTime || 0),
      0
    );
    const totalStarted = completed + inProgress;
    const completionRate = totalStarted > 0 ? Math.round((completed / totalStarted) * 100) : 0;
    return {
      booksCompleted: completed,
      booksInProgress: inProgress,
      totalReadingTime: totalSeconds,
      completionRate,
    };
  };

  const stats = getStats();
  const avgQuiz = averageQuizAcrossSessions();

  /* ============================== UI ============================== */
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-navy-50 to-ilaw-white">
      <Header variant="student" />

      <main className="flex-grow p-4 md:p-6">
        <div className="container mx-auto">
          {/* Hero */}
          <div className="bg-gradient-to-r from-ilaw-navy to-brand-navy-800 rounded-2xl p-8 mb-8 text-ilaw-white shadow-navy">
            <div className="flex items-center mb-4">
              <Target className="h-10 w-10 text-ilaw-gold mr-4" />
              <div>
                <span className="text-sm font-semibold uppercase tracking-wide text-brand-gold-200">
                  Learning Progress
                </span>
              </div>
            </div>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-4xl md:text-5xl font-sans font-bold mb-4">My Reading Journey</h1>
                <p className="text-xl text-brand-gold-100 leading-relaxed">
                  Track your learning achievements and celebrate your progress on the path to
                  knowledge.
                </p>
                <div className="mt-6 flex items-center text-ilaw-gold">
                  <Star className="h-5 w-5 mr-2" />
                  <span className="font-medium italic">Liwanag, Kaalaman, Paglilingkod</span>
                </div>
              </div>
              <div className="mt-6 md:mt-0">
                <Link href="/student">
                  <Button
                    variant="outline"
                    className="border-2 border-ilaw-gold text-ilaw-gold hover:bg-ilaw-gold hover:text-ilaw-navy font-sans font-bold px-6 py-3"
                  >
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Back to Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          <Tabs
            defaultValue="overview"
            value={activeTab}
            onValueChange={setActiveTab}
            className="mb-8"
          >
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-brand-gold-100 border-2 border-brand-gold-200">
              <TabsTrigger
                value="overview"
                className="font-sans font-bold text-ilaw-navy data-[state=active]:bg-ilaw-gold data-[state=active]:text-ilaw-navy"
              >
                📊 Overview
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="font-sans font-bold text-ilaw-navy data-[state=active]:bg-ilaw-gold data-[state=active]:text-ilaw-navy"
              >
                📚 Reading History
              </TabsTrigger>
            </TabsList>

            {/* OVERVIEW */}
            <TabsContent value="overview">
              {/* Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <Card className="border-2 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-gradient-to-br from-ilaw-white to-brand-gold-50">
                  <CardContent className="pt-6">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-base text-yellow-600 font-semibold">Books Completed</p>
                        <h3 className="text-3xl font-sans font-bold mt-1 text-ilaw-navy">
                          {stats.booksCompleted}
                        </h3>
                      </div>
                      <div className="bg-gradient-to-br from-amber-200 to-yellow-200 h-12 w-12 rounded-full flex items-center justify-center shadow-md">
                        <BookOpen className="h-6 w-6 text-ilaw-navy" />
                      </div>
                    </div>
                    <div className="mt-4 text-base text-yellow-600">
                      <span className="text-green-600 items-center inline-flex font-semibold">
                        <TrendingUp className="h-4 w-4 mr-1" />
                        {stats.booksInProgress} books in progress
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-gradient-to-br from-ilaw-white to-brand-gold-50">
                  <CardContent className="pt-6">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-base text-yellow-600 font-semibold">Reading Time</p>
                        <h3 className="text-3xl font-sans font-bold mt-1 text-ilaw-navy">
                          {formatReadingTime(stats.totalReadingTime)}
                        </h3>
                      </div>
                      <div className="bg-gradient-to-br from-ilaw-gold to-brand-amber h-12 w-12 rounded-full flex items-center justify-center shadow-md">
                        <Clock className="h-6 w-6 text-ilaw-navy" />
                      </div>
                    </div>
                    <div className="mt-4 text-base text-yellow-600">
                      <span className="text-green-600 items-center inline-flex font-semibold">
                        <ArrowUpRight className="h-4 w-4 mr-1" />
                        Keep up the great work!
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-gradient-to-br from-ilaw-white to-brand-gold-50">
                  <CardContent className="pt-6">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-base text-yellow-600 font-semibold">Completion Rate</p>
                        <h3 className="text-3xl font-sans font-bold mt-1 text-ilaw-navy">
                          {stats.completionRate}%
                        </h3>
                      </div>
                      <div className="bg-gradient-to-br from-green-200 to-emerald-200 h-12 w-12 rounded-full flex items-center justify-center shadow-md">
                        <BarChart3 className="h-6 w-6 text-green-700" />
                      </div>
                    </div>
                    <div className="mt-4 text-base text-yellow-600">
                      <span className="text-green-600 items-center inline-flex font-semibold">
                        <TrendingUp className="h-4 w-4 mr-1" />
                        Steadily improving
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-gradient-to-br from-ilaw-white to-brand-gold-50">
                  <CardContent className="pt-6">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-base text-yellow-600 font-semibold">Average Quiz Score</p>
                        <h3 className="text-3xl font-sans font-bold mt-1 text-ilaw-navy">
                          {avgQuiz != null ? `${avgQuiz}%` : "—"}
                        </h3>
                      </div>
                      <div className="bg-gradient-to-br from-amber-200 to-yellow-200 h-12 w-12 rounded-full flex items-center justify-center shadow-md">
                        <BarChart3 className="h-6 w-6 text-ilaw-navy" />
                      </div>
                    </div>
                    <div className="mt-4 text-base text-yellow-600">
                      <span className="text-green-600 items-center inline-flex font-semibold">
                        <TrendingUp className="h-4 w-4 mr-1" />
                        Practice boosts scores
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 🟡 Exclusive Story Badges (only if actually earned) */}
              {!badgesLoading && !badgesError && exclusiveEarned.length > 0 && (
                <div className="mb-8 border-2 border-brand-gold-200 bg-white rounded-2xl overflow-hidden shadow-lg">
                  <div className="bg-gradient-to-r from-indigo-700 to-purple-800 px-6 py-4 flex items-center justify-between">
                    <h3 className="text-xl font-sans font-bold text-white flex items-center">
                      <Sparkles className="h-6 w-6 mr-3 text-yellow-300" />
                      Exclusive Story Badges
                      <span className="ml-3 text-purple-200 text-sm font-semibold">
                        ({exclusiveEarned.length})
                      </span>
                    </h3>
                  </div>

                  <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {exclusiveEarned
                      .slice()
                      .sort((a, b) => (a.badge?.name || "").localeCompare(b.badge?.name || ""))
                      .map((eb) => {
                        const icon = getBadgeIconUrl(eb.badge, 80);
                        const awardedAt =
                          (eb as any).awardedAt ??
                          (eb as any).awarded_at ??
                          (eb as any).createdAt ??
                          (eb as any).created_at ??
                          null;

                        // subtle themed card
                        return (
                          <div
                            key={`${eb.id}-${eb.badgeId}`}
                            className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200"
                          >
                            <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-indigo-200/50" />
                            <div className="absolute -bottom-8 -left-8 w-28 h-28 rounded-full bg-purple-200/40" />

                            <div className="relative p-4 flex items-center gap-4">
                              <div className="w-14 h-14 rounded-lg bg-white border border-indigo-200 shadow-sm grid place-items-center overflow-hidden">
                                {icon ? (
                                  <img src={icon} alt={eb.badge?.name || "Badge"} className="w-full h-full object-cover" />
                                ) : (
                                  <Moon className="w-6 h-6 text-indigo-700" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-sans font-bold text-indigo-900 truncate">
                                  {eb.badge?.name}
                                </div>
                                <div className="text-xs text-indigo-700/80">
                                  {formatDate(awardedAt)}
                                </div>
                                <div className="mt-1 text-xs text-indigo-800/80 line-clamp-2">
                                  {eb.badge?.description || eb.note || "Exclusive finisher badge"}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* 🏅 Badges Earned — TABLE STYLE (other badges only) */}
              <div className="mb-8 border-2 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-ilaw-white rounded-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-ilaw-navy to-brand-navy-800 px-6 py-4 rounded-t-xl flex items-center justify-between">
                  <h3 className="text-xl font-sans font-bold text-ilaw-gold flex items-center">
                    <Award className="h-6 w-6 mr-3" />
                    Earned Badges
                    {otherEarned?.length > 0 && (
                      <span className="ml-3 text-brand-gold-200 text-sm font-semibold">
                        ({otherEarned.length} {otherEarned.length === 1 ? "badge" : "badges"})
                      </span>
                    )}
                  </h3>
                </div>

                <div className="p-0">
                  {badgesLoading ? (
                    <div className="text-center py-10">
                      <Loader2 className="h-8 w-8 animate-spin text-ilaw-gold inline-block mb-3" />
                      <p className="text-yellow-600 font-semibold">Loading your badges…</p>
                    </div>
                  ) : badgesError ? (
                    <div className="text-center py-10">
                      <p className="text-red-600 font-semibold">
                        Sorry, we couldn’t load your badges.
                      </p>
                    </div>
                  ) : otherEarned.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="bg-gradient-to-br from-amber-200 to-yellow-200 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                        <Award className="h-12 w-12 text-ilaw-navy" />
                      </div>
                      <h4 className="text-2xl font-sans font-bold text-ilaw-navy mb-2">No badges yet</h4>
                      <p className="text-base text-yellow-600">
                        Read books and complete quizzes to earn badges!
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-brand-gold-50 border-brand-gold-200">
                          <TableHead className="text-ilaw-navy font-sans font-bold w-[34%]">
                            BADGE
                          </TableHead>
                          <TableHead className="text-ilaw-navy font-sans font-bold w-[26%]">
                            BOOK
                          </TableHead>
                          <TableHead className="text-ilaw-navy font-sans font-bold">
                            DESCRIPTION
                          </TableHead>
                          <TableHead className="text-ilaw-navy font-sans font-bold w-[140px]">
                            AWARDED
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {otherEarned
                          .slice()
                          .sort((a, b) => {
                            const aDate =
                              (a as any).awardedAt ??
                              (a as any).awarded_at ??
                              (a as any).createdAt ??
                              (a as any).created_at;
                            const bDate =
                              (b as any).awardedAt ??
                              (b as any).awarded_at ??
                              (b as any).createdAt ??
                              (b as any).created_at;
                            const ta = aDate ? new Date(aDate).getTime() : 0;
                            const tb = bDate ? new Date(bDate).getTime() : 0;
                            return tb - ta;
                          })
                          .map((eb) => {
                            const icon = getBadgeIconUrl(eb.badge, 64);
                            const title =
                              eb.book?.title ??
                              (eb.bookId && bookTitleById.get(eb.bookId)) ??
                              (eb.bookId ? `Book #${eb.bookId}` : "");
                            const awardedAt =
                              (eb as any).awardedAt ??
                              (eb as any).awarded_at ??
                              (eb as any).createdAt ??
                              (eb as any).created_at ??
                              null;
                            const desc =
                              eb.badge?.description ??
                              eb.note ??
                              "Badge earned";

                            return (
                              <TableRow
                                key={`${eb.id}-${eb.badgeId}`}
                                className="border-brand-gold-100 hover:bg-brand-gold-50/60"
                              >
                                {/* Badge */}
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-brand-gold-50 border border-brand-gold-200 flex items-center justify-center shrink-0">
                                      {icon ? (
                                        <img
                                          src={icon}
                                          alt={eb.badge?.name || "Badge"}
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <Award className="h-5 w-5 text-ilaw-gold" />
                                      )}
                                    </div>
                                    <div className="font-sans font-bold text-ilaw-navy">
                                      {eb.badge?.name ?? `Badge #${eb.badgeId}`}
                                    </div>
                                  </div>
                                </TableCell>

                                {/* Book */}
                                <TableCell>
                                  <div className="flex items-center gap-2 text-ilaw-navy">
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-100 border border-amber-200">
                                      <BookOpen className="w-3.5 h-3.5 text-ilaw-navy" />
                                    </span>
                                    <span className="font-medium">{title || "—"}</span>
                                  </div>
                                </TableCell>

                                {/* Description */}
                                <TableCell className="text-yellow-700">
                                  {desc}
                                </TableCell>

                                {/* Awarded */}
                                <TableCell className="text-ilaw-navy font-medium">
                                  {formatDate(awardedAt)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>

              {/* Current Progress */}
              <div className="border-2 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-ilaw-white rounded-2xl">
                <div className="bg-gradient-to-r from-ilaw-navy to-brand-navy-800 p-6 rounded-t-xl">
                  <h3 className="text-xl font-sans font-bold text-ilaw-gold flex items-center">
                    <GraduationCap className="h-6 w-6 mr-3" />
                    📖 Current Reading Progress
                  </h3>
                </div>
                <div className="p-6 overflow-x-hidden">
                  {isLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-pulse">
                        <div className="bg-gradient-to-br from-amber-200 to-yellow-200 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                          <BookOpen className="h-8 w-8 text-ilaw-navy" />
                        </div>
                        <p className="text-yellow-600 font-medium">Loading your progress...</p>
                      </div>
                    </div>
                  ) : (() => {
                      const unique = getUniqueProgress(progressData?.progress || []);
                      const inProgressBooks = unique.filter((p: any) => p.percentComplete < 100);

                      return inProgressBooks.length > 0 ? (
                        <div className="space-y-6">
                          {inProgressBooks
                            .sort(
                              (a: any, b: any) =>
                                new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime()
                            )
                            .slice(0, 3)
                            .map((progress: any) => {
                              const bookId: number = progress.book?.id ?? progress.bookId;
                              const latestSession = latestQuizForBook(bookId);
                              const attemptsCount = sessionsForBook(bookId).length;
                              const href = getReadingUrl(progress);

                              return (
                                <div
                                  key={bookId ?? progress.book?.title ?? Math.random()}
                                  className="flex items-start w-full min-w-0 p-4 sm:p-6 bg-gradient-to-r from-brand-gold-50 to-ilaw-white rounded-xl border-2 border-brand-gold-200 hover:border-ilaw-gold hover:shadow-md transition-all duration-300"
                                >
                                  <div className="flex-shrink-0 w-16 h-24 bg-gradient-to-br from-amber-200 to-yellow-200 rounded-lg flex items-center justify-center mr-4 shadow-md">
                                    {progress.book?.coverImage ? (
                                      <img
                                        src={progress.book.coverImage}
                                        alt={progress.book.title}
                                        className="w-full h-full object-cover rounded-lg"
                                      />
                                    ) : (
                                      <BookOpen className="h-6 w-6 text-ilaw-navy" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-sans font-bold text-ilaw-navy text-lg mb-2 truncate">
                                      {progress.book?.title}
                                    </h4>

                                    <div className="flex flex-wrap gap-2 mb-3">
                                      <Badge
                                        variant="outline"
                                        className={`border-2 font-bold text-xs ${
                                          progress.book?.type === "storybook"
                                            ? "border-brand-gold-300 bg-brand-gold-100 text-yellow-600"
                                            : "border-ilaw-navy-300 bg-ilaw-navy-100 text-ilaw-navy"
                                        }`}
                                      >
                                        {progress.book?.type === "storybook"
                                          ? "📚 Storybook"
                                          : "🎓 Educational"}
                                      </Badge>
                                      {progress.book?.subject && (
                                        <Badge
                                          variant="outline"
                                          className="border-2 border-amber-300 bg-amber-50 text-yellow-600 font-bold text-xs"
                                        >
                                          {formatSubject(progress.book.subject)}
                                        </Badge>
                                      )}
                                      {progress.book?.grade && (
                                        <Badge
                                          variant="outline"
                                          className="border-2 border-brand-gold-300 text-yellow-600 font-bold text-xs"
                                        >
                                          Grade {progress.book.grade === "K" ? "K" : progress.book.grade}
                                        </Badge>
                                      )}

                                      {latestSession && (
                                        <Badge
                                          variant="outline"
                                          className={`border-2 font-bold text-xs ${quizBadgeClass(
                                            latestSession.percentage
                                          )}`}
                                        >
                                          🧠 Last quiz: {latestSession.percentage}% ({latestSession.mode})
                                        </Badge>
                                      )}
                                      {attemptsCount > 0 && (
                                        <Badge
                                          variant="outline"
                                          className="border-2 text-ilaw-navy font-bold text-xs"
                                        >
                                          {attemptsCount} {attemptsCount === 1 ? "attempt" : "attempts"}
                                        </Badge>
                                      )}
                                    </div>

                                    <p className="text-sm text-yellow-600 font-medium mb-3">
                                      {progress.currentChapter || "Chapter 1"} • Last read:{" "}
                                      {new Date(progress.lastReadAt).toLocaleDateString()}
                                    </p>
                                    <div className="mb-2">
                                      <div className="flex justify-between text-xs text-yellow-600 mb-2 font-medium">
                                        <span>Progress</span>
                                        <span>{progress.percentComplete}%</span>
                                      </div>
                                      <Progress value={progress.percentComplete} className="h-3" />
                                    </div>

                                    <Link href={href}>
                                      <Button
                                        variant="link"
                                        className="p-0 h-auto text-ilaw-navy hover:text-ilaw-gold font-sans font-bold flex items-center transition-colors duration-200"
                                      >
                                        Continue Reading <ChevronRight className="h-4 w-4 ml-1" />
                                      </Button>
                                    </Link>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="bg-gradient-to-br from-amber-200 to-yellow-200 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                            <BookOpen className="h-12 w-12 text-ilaw-navy" />
                          </div>
                          <h4 className="text-2xl font-sans font-bold text-ilaw-navy mb-4">
                            Ready to Start Your Learning Journey?
                          </h4>
                          <p className="text-yellow-600 font-medium mb-2">No books in progress yet</p>
                          <p className="text-sm text-yellow-600">
                            Choose a book from our collection to begin tracking your progress
                          </p>
                        </div>
                      );
                    })()}
                </div>
              </div>
            </TabsContent>

            {/* HISTORY */}
            <TabsContent value="history">
              <div className="border-2 border-brand-gold-200 hover:border-ilaw-gold transition-all duration-300 shadow-lg bg-ilaw-white rounded-2xl">
                <div className="bg-gradient-to-r from-ilaw-navy to-brand-navy-800 p-6 rounded-t-xl">
                  <h3 className="text-xl font-sans font-bold text-ilaw-gold flex items-center">
                    <BookOpen className="h-6 w-6 mr-3" />
                    📚 Reading History
                  </h3>
                </div>
                <div className="p-6">
                  {isLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-pulse">
                        <div className="bg-gradient-to-br from-amber-200 to-yellow-200 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                          <BookOpen className="h-8 w-8 text-ilaw-navy" />
                        </div>
                        <p className="text-yellow-600 font-medium">Loading your history...</p>
                      </div>
                    </div>
                  ) : (() => {
                      const unique = getUniqueProgress(progressData?.progress || []);
                      return unique.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow className="border-brand-gold-200">
                              <TableHead className="text-ilaw-navy font-sans font-bold">📖 Book</TableHead>
                              <TableHead className="text-ilaw-navy font-sans font-bold">📋 Details</TableHead>
                              <TableHead className="text-ilaw-navy font-sans font-bold">📊 Progress</TableHead>
                              <TableHead className="text-ilaw-navy font-sans font-bold text-center w-28 whitespace-nowrap">
                                ⏱️ Reading Time
                              </TableHead>
                              <TableHead className="text-ilaw-navy font-sans font-bold">📅 Last Read</TableHead>
                              <TableHead className="text-ilaw-navy font-sans font-bold">🧠 Quiz (Latest)</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unique
                              .sort(
                                (a: any, b: any) =>
                                  new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime()
                              )
                              .map((progress: any) => {
                                const bookId: number = progress.book?.id ?? progress.bookId;
                                const latest = latestQuizForBook(bookId);
                                const count = sessionsForBook(bookId).length;
                                const href = getReadingUrl(progress);
                                return (
                                  <TableRow
                                    key={bookId ?? progress.book?.title ?? Math.random()}
                                    className="border-brand-gold-100 hover:bg-brand-gold-50 transition-colors duration-200"
                                  >
                                    <TableCell>
                                      <div className="flex items-center">
                                        <div className="w-12 h-16 bg-gradient-to-br from-amber-200 to-yellow-200 rounded-lg flex items-center justify-center mr-3 shadow-sm">
                                          {progress.book?.coverImage ? (
                                            <img
                                              src={progress.book.coverImage}
                                              alt={progress.book.title}
                                              className="w-full h-full object-cover rounded-lg"
                                            />
                                          ) : (
                                            <BookOpen className="h-5 w-5 text-ilaw-navy" />
                                          )}
                                        </div>
                                        <div>
                                          <div className="font-sans font-bold text-ilaw-navy">
                                            {progress.book?.title}
                                          </div>
                                          <div className="text-xs text-yellow-600 font-medium">
                                            {progress.currentChapter || "Chapter 1"}
                                          </div>
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex flex-wrap gap-1">
                                        <Badge
                                          variant="outline"
                                          className={`border font-bold text-xs ${
                                            progress.book?.type === "storybook"
                                              ? "border-brand-gold-300 bg-brand-gold-100 text-yellow-600"
                                              : "border-ilaw-navy-300 bg-ilaw-navy-100 text-ilaw-navy"
                                          }`}
                                        >
                                          {progress.book?.type === "storybook" ? "📚 Story" : "🎓 Educational"}
                                        </Badge>
                                        {progress.book?.subject && (
                                          <Badge
                                            variant="outline"
                                            className="border border-amber-300 bg-amber-50 text-yellow-600 font-bold text-xs"
                                          >
                                            {formatSubject(progress.book.subject)?.split(" ")[0]}
                                          </Badge>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="w-full max-w-[100px]">
                                        <div className="text-xs text-yellow-600 mb-1 flex justify-between font-medium">
                                          <span>{progress.percentComplete}%</span>
                                          {progress.percentComplete === 100 && (
                                            <span className="text-green-600 font-bold">✓ Done</span>
                                          )}
                                        </div>
                                        <Progress value={progress.percentComplete} className="h-2" />
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-yellow-600 font-medium text-center w-24">
                                      {formatReadingTime(progress.totalReadingTime || 0)}
                                    </TableCell>
                                    <TableCell className="text-yellow-600 font-medium">
                                      {new Date(progress.lastReadAt).toLocaleDateString()}
                                    </TableCell>

                                    <TableCell>
                                      {latest ? (
                                        <div className="flex items-center gap-2">
                                          <Badge
                                            variant="outline"
                                            className={`font-bold ${quizBadgeClass(latest.percentage)}`}
                                          >
                                            {latest.percentage}%{" "}
                                            <span className="ml-1 text-[10px] opacity-70">({latest.mode})</span>
                                          </Badge>
                                          <Badge variant="outline" className="font-bold text-ilaw-navy">
                                            {count} {count === 1 ? "attempt" : "attempts"}
                                          </Badge>
                                        </div>
                                      ) : (
                                        <span className="text-yellow-600">—</span>
                                      )}
                                    </TableCell>

                                    <TableCell>
                                      {progress.percentComplete === 100 ? (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-green-600 hover:text-green-700 font-sans font-bold"
                                          disabled
                                        >
                                          ✓ Completed
                                        </Button>
                                      ) : (
                                        <Link href={href}>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-ilaw-navy hover:text-ilaw-gold hover:bg-brand-gold-50 font-sans font-bold transition-colors duration-200"
                                          >
                                            Continue →
                                          </Button>
                                        </Link>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="text-center py-12">
                          <div className="bg-gradient-to-br from-amber-200 to-yellow-200 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                            <BookOpen className="h-12 w-12 text-ilaw-navy" />
                          </div>
                          <h4 className="text-2xl font-sans font-bold text-ilaw-navy mb-4">
                            Your Reading Adventure Begins Here!
                          </h4>
                          <p className="text-yellow-600 font-medium mb-2">No reading history found yet</p>
                          <p className="text-sm text-yellow-600">Start reading to build your learning journey</p>
                        </div>
                      );
                    })()}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}