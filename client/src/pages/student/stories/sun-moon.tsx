import { useState, useEffect, useRef, memo, lazy, Suspense } from "react";
import { Link } from "wouter";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Home,
  Volume2,
  VolumeX,
  Check,
  Maximize,
  Minimize,
  RefreshCw,
  Sparkles,
  Sun,
  Moon,
  Languages, // NEW
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
const LoopingVideoLazy = lazy(() => import("@/components/LoopingVideo"));

// media (GIFs removed after optimization; videos now defined in JSON pages)
// NOTE: original heavy GIF imports were removed to reduce bundle size & network transfer.
// The story now relies on videoMp4/videoWebm fields inside the dynamic JSON pages.
// If you still need a lightweight poster for initial preload, add it as page.videoPoster in JSON.
import bg from "@/assets/bookanimation/sun and moon.png";
import "@/pages/student/stories/2danimatedstorybook.css";
import "./sun-moon.css";
// checkpoint helpers
import {
  getCheckpoint as getCheckpointAPI,
  saveCheckpoint as saveCheckpointAPI,
  resetCheckpoint as resetCheckpointAPI,
} from "@/lib/stories/checkpointClient";

import { markBookComplete as markBookCompleteAPI } from "@/lib/clients/completeClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/* ===== meta ===== */
const BOOK_SLUG = "sun-moon";
const BOOK_ID: number | undefined = undefined;

/* ===== types ===== */
type QAOption = { slug: string; text: string; correct: boolean };
type Quiz = { questionSlug: string; question: string; options: QAOption[] };
type Page = { id: string; title?: string; narration: string; character?: string; illustration?: string; quiz?: Quiz; videoMp4?: string; videoWebm?: string; videoPoster?: string; videoInitialStart?: number; videoInitialEnd?: number; videoLoopStart?: number; videoLoopEnd?: number; videoPlaybackRate?: number };

/* ===== i18n / language support ===== */
type Lang = "en" | "fil";
const LANG_KEY = "ags.lang";

const detectInitialLang = (): Lang => {
  try {
    const saved = (localStorage.getItem(LANG_KEY) || "").toLowerCase();
    if (saved === "en" || saved === "fil") return saved as Lang;
  } catch {}
  const nav = (navigator.language || (navigator as any).userLanguage || "").toLowerCase();
  const langs = (navigator.languages || []).map((l) => l.toLowerCase());
  const anyFil = [nav, ...langs].some((l) => l.startsWith("fil") || l.startsWith("tl"));
  if (anyFil) return "fil";
  if (nav.endsWith("-ph") || langs.some((l) => l.endsWith("-ph"))) return "fil"; // e.g. en-PH
  return "en";
};

const useLang = () => {
  const [lang, setLang] = useState<Lang>(detectInitialLang());
  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
  }, [lang]);
  return { lang, setLang };
};

const i18n = {
  en: {
    title: "The Sun and the Moon",
    subtitle: "Warming the day, calming the night…",
    backToStories: "Back to Stories",
    pageOf: (a: string, b: string) => `Page ${a} of ${b}`,
    pageRangeOf: (a: string, b: string, c: string) => `Page ${a}–${b} of ${c}`,
    unlockHint: "unlock the next page by answering the question (if any)",
    question: "Question",
    submit: "Submit",
    tryAgain: "Try Again",
    continue: "Continue",
    correct: "Correct! You may continue.",
    wrong: "Oops, try again.",
    readAgain: "Read Again from Start",
    backToShelf: "Back to Story Shelf",
    finaleThanksTitle: "Thank you! ☀️🌙",
    finaleThanksDesc:
      "Apolaqui’s bright sun by day; Mayari’s gentle moon by night. Thanks for reading this legend of balance and peace.",
    reflectionHeader: "Quick reflection:",
    reflectionQ1: "How did the siblings turn a conflict into harmony?",
    reflectionQ2: "Where do you see “sharing time” in your own day?",
    langToggle: (lang: Lang) => (lang === "en" ? "FIL" : "EN"),
    langToggleAria: "Toggle language",
    loading: "Loading",
  },
  fil: {
    title: "Ang Araw at ang Buwan",
    subtitle: "Init sa umaga, aliwalas sa gabi…",
    backToStories: "Bumalik sa mga Kuwento",
    pageOf: (a: string, b: string) => `Pahina ${a} ng ${b}`,
    pageRangeOf: (a: string, b: string, c: string) => `Pahina ${a}–${b} ng ${c}`,
    unlockHint: "i-unlock ang susunod na pahina sa pagsagot sa tanong (kung meron)",
    question: "Tanong",
    submit: "Isumite",
    tryAgain: "Subukang Muli",
    continue: "Magpatuloy",
    correct: "Tama! Maaari ka nang magpatuloy.",
    wrong: "Ay naku, subukan muli.",
    readAgain: "Basahin Muli mula Simula",
    backToShelf: "Bumalik sa Estante",
    finaleThanksTitle: "Maraming salamat! ☀️🌙",
    finaleThanksDesc:
      "Tirik na liwanag ni Apolaqui sa araw; banayad na sinag ni Mayari sa gabi. Salamat sa pagbasa sa alamat ng balanse at pagkakasundo.",
    reflectionHeader: "Mabilis na pagninilay:",
    reflectionQ1: "Paano nagawang gawing pagkakasundo ang alitan ng magkapatid?",
    reflectionQ2: "Saan mo nakikita ang “pagpapalitan ng oras” sa araw mo?",
    langToggle: (lang: Lang) => (lang === "en" ? "FIL" : "EN"),
    langToggleAria: "Palitan ang wika",
    loading: "Naglo-load",
  },
} as const;

async function loadPages(lang: Lang) {
  const mod = await import(`@/content/stories/sun-moon.${lang}.json`);
  const arr = (mod.default || []) as any[];
  return arr.map((p) => ({
    ...p,
    // normalize video paths to absolute-safe URLs (same withBase helper used in necklace-comb)
    videoMp4: p.videoMp4 ? withBase(p.videoMp4) : undefined,
    videoWebm: p.videoWebm ? withBase(p.videoWebm) : undefined,
    videoPoster: p.videoPoster ? withBase(p.videoPoster) : undefined,
  }));
}

function withBase(path: string) {
  return '/' + path.replace(/^\//, '');
}

export default function SunMoonStory() {
  const { lang, setLang } = useLang(); // NEW
  const { toast } = useToast();
  const completionHandledRef = useRef(false);
  const [spreadStart, setSpreadStart] = useState(0);
  const [rightUnlocked, setRightUnlocked] = useState(false);
  const [pendingSide, setPendingSide] = useState<null | "left" | "right">(null);
  const [quizPageIndex, setQuizPageIndex] = useState<number | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStoryComplete, setIsStoryComplete] = useState(false);

  // loader + intro
  const [isBooting, setIsBooting] = useState(true);
  const [entered, setEntered] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  // Dynamic pages
  const [storyPagesState, setStoryPagesState] = useState<Page[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setPagesLoading(true);
    loadPages(lang).then((p) => { if (!cancelled) { setStoryPagesState(p); setPagesLoading(false); } }).catch(() => { if (!cancelled) setPagesLoading(false); });
    return () => { cancelled = true; };
  }, [lang]);

  // Boot lifecycle: hide loader when pages are ready or after a max timeout
  useEffect(() => {
    if (!isBooting) return; // already finished
    // failsafe: force hide after 5s
    const failTimer = setTimeout(() => setIsBooting(false), 5000);
    return () => clearTimeout(failTimer);
  }, [isBooting]);

  useEffect(() => {
    if (isBooting && !pagesLoading) {
      // slight delay so loader isn't a flash
      const t = setTimeout(() => {
        setIsBooting(false);
        // entrance animations
        requestAnimationFrame(() => setEntered(true));
        setPlayOpen(true);
        setTimeout(() => setPlayOpen(false), 900);
      }, 250);
      return () => clearTimeout(t);
    }
  }, [pagesLoading, isBooting]);

  // quiz local ui
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [feedback, setFeedback] = useState("");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const typedCacheRef = useRef<Set<string>>(new Set());
  const [flipRightNow, setFlipRightNow] = useState(false);

  // fullscreen tracking
  useEffect(() => {
    const onFsChange = () => {
      const on = !!document.fullscreenElement;
      setIsFullscreen(on);
      document.body.classList.toggle("book-fullscreen-mode", on);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("book-fullscreen-mode", isFullscreen);
    return () => document.body.classList.remove("book-fullscreen-mode");
  }, [isFullscreen]);

  // preload background + first illustration/poster (from first page once loaded) for nicer entrance
  useEffect(() => {
    let cancelled = false;
    const preload = (src: string | undefined) => {
      if (!src) return Promise.resolve();
      return new Promise<void>((r) => { const img = new Image(); img.onload = img.onerror = () => r(); img.src = src; });
    };
    (async () => {
      // Wait briefly for pages to load so we can pick a poster/illustration
      let firstPoster: string | undefined;
      if (storyPagesState.length > 0) {
        const p0 = storyPagesState[0];
        firstPoster = p0?.videoPoster || p0?.illustration;
      }
      await Promise.all([preload(bg), preload(firstPoster)]);
      await new Promise((r) => setTimeout(r, 120));
      if (cancelled) return;
      setIsBooting(false);
      requestAnimationFrame(() => { setEntered(true); setPlayOpen(true); setTimeout(() => setPlayOpen(false), 750); });
    })();
    return () => { cancelled = true; };
  }, [storyPagesState]);

  // Idle prefetch of subsequent video posters / illustrations after initial interactive
  useEffect(() => {
    if (!storyPagesState.length) return;
    const rest = storyPagesState.slice(1);
    const prefetch = () => {
      rest.forEach(p => {
        const src = p.videoPoster || p.illustration;
        if (!src) return;
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'lazy';
        img.src = src;
      });
    };
    if ('requestIdleCallback' in window) (window as any).requestIdleCallback(prefetch, { timeout: 2500 }); else setTimeout(prefetch, 1500);
  }, [storyPagesState]);

  /* ===== story pages (now language-driven) ===== */
  const storyPages = storyPagesState;
  const leftIndex = spreadStart;
  const rightIndex = spreadStart + 1;

  // keyboard arrows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pendingSide || isFlipping) return;
      if (e.key === "ArrowRight") { e.preventDefault(); handleNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); handlePrev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingSide, isFlipping, leftIndex, rightIndex, rightUnlocked]);

  // fullscreen toggle
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.({ navigationUI: "hide" } as any);
      } else {
        await document.exitFullscreen();
      }
    } catch {
      const v = !isFullscreen;
      setIsFullscreen(v);
      document.body.classList.toggle("book-fullscreen-mode", v);
    }
  };

  /* ===== quiz state ===== */
  const [answers, setAnswers] = useState<Record<string, string>>({});

  /* ===== nav with gating ===== */
  const handleNext = () => {
    if (pendingSide || isFlipping) return;

    if (rightIndex >= storyPages.length) {
      setIsStoryComplete(true);
      if (!completionHandledRef.current) {
        completionHandledRef.current = true;
        (async () => {
          try {
            const resp = await markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG);
            if (resp?.awardedBadge?.badgeName) {
              toast({ title: "Badge Earned!", description: resp.awardedBadge.badgeName });
            }
          } catch {}
          queryClient.invalidateQueries({ queryKey: ["earned-badges"] });
        })();
      }
      saveCheckpoint(true).catch(() => {});
      return;
    }

    const goingSide: "left" | "right" = rightUnlocked ? "right" : "left";
    const targetIndex = goingSide === "left" ? leftIndex : rightIndex;

    const targetHasQuiz = !!storyPages[targetIndex]?.quiz;
    if (targetHasQuiz) {
      setPendingSide(goingSide);
      setQuizPageIndex(targetIndex);
      return;
    }

    if (goingSide === "left") {
      setRightUnlocked(true);
      saveCheckpoint().catch(() => {});
    } else {
      setIsFlipping(true);
      setFlipRightNow(true);
      setTimeout(() => {
        const nextLeft = spreadStart + 2;
        if (nextLeft >= storyPages.length) {
          setIsStoryComplete(true);
          if (!completionHandledRef.current) {
            completionHandledRef.current = true;
            (async () => {
              try {
                const resp = await markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG);
                if (resp?.awardedBadge?.badgeName) {
                  toast({ title: "Badge Earned!", description: resp.awardedBadge.badgeName });
                }
              } catch {}
              queryClient.invalidateQueries({ queryKey: ["earned-badges"] });
            })();
          }
          saveCheckpoint(true).catch(() => {});
        } else {
          setSpreadStart(nextLeft);
          setRightUnlocked(false);
          saveCheckpoint().catch(() => {});
        }
        setIsFlipping(false);
        setFlipRightNow(false);
      }, 650);
    }
  };

  const handlePrev = () => {
    if (pendingSide || isFlipping) return;
    if (spreadStart > 0) {
      setIsFlipping(true);
      setTimeout(() => {
        setSpreadStart((prev) => Math.max(0, prev - 2));
        setRightUnlocked(true);
        setIsFlipping(false);
        saveCheckpoint().catch(() => {});
      }, 500);
    }
  };

  // quiz helpers
  const resetQuiz = () => { setSelectedAnswer(""); setHasAnswered(false); setIsCorrect(false); setFeedback(""); };

  const handleAnswerSubmit = () => {
    if (quizPageIndex == null) return;
    const q = storyPages[quizPageIndex]?.quiz;
    if (!q) return;

    const correct = q.options.find((o) => o.slug === selectedAnswer)?.correct;
    const ok = !!correct;
    setIsCorrect(ok);
    setHasAnswered(true);
    setFeedback(ok ? i18n[lang].correct : i18n[lang].wrong); // localized

    if (ok) {
      setAnswers((prev) => ({ ...prev, [q.questionSlug]: selectedAnswer }));
    }
  };

  const tryAgain = () => resetQuiz();

  const continueAfterCorrect = () => {
    if (!isCorrect || pendingSide == null) return;
    if (pendingSide === "left") {
      setRightUnlocked(true);
      setPendingSide(null);
      setQuizPageIndex(null);
      resetQuiz();
      saveCheckpoint().catch(() => {});
    } else {
      setPendingSide(null);
      setQuizPageIndex(null);
      resetQuiz();
      setFlipRightNow(true);
      setIsFlipping(true);
      setTimeout(() => {
        const nextLeft = spreadStart + 2;
        if (nextLeft >= storyPages.length) {
          setIsStoryComplete(true);
          if (!completionHandledRef.current) {
            completionHandledRef.current = true;
            (async () => {
              try {
                const resp = await markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG);
                if (resp?.awardedBadge?.badgeName) {
                  toast({ title: "Badge Earned!", description: resp.awardedBadge.badgeName });
                }
              } catch {}
              queryClient.invalidateQueries({ queryKey: ["earned-badges"] });
            })();
          }
          saveCheckpoint(true).catch(() => {});
        } else {
          setSpreadStart(nextLeft);
          setRightUnlocked(false);
          saveCheckpoint().catch(() => {});
        }
        setIsFlipping(false);
        setFlipRightNow(false);
      }, 650);
    }
  };

  const toggleMute = () => setIsMuted((v) => !v);

  const restartStory = () => {
    setSpreadStart(0);
    setRightUnlocked(false);
    setPendingSide(null);
    setQuizPageIndex(null);
    setIsStoryComplete(false);
    setFlipRightNow(false);
    setAnswers({});
    resetQuiz();
    resetCheckpointAPI(BOOK_SLUG).catch(() => {});
    saveCheckpoint().catch(() => {});
  };

  // typing effect
  const TypingText = memo(function TypingTextMemo({
    text,
    className,
    speed = 45,
    startDelay = 120,
    cacheKey,
    onDone,
  }: { text: string; className?: string; speed?: number; startDelay?: number; cacheKey: string; onDone?: () => void }) {
    const alreadyTyped = typedCacheRef.current.has(cacheKey);
    const [out, setOut] = useState(alreadyTyped ? text : "");
    const [done, setDone] = useState(alreadyTyped);

    useEffect(() => {
      if (alreadyTyped) return;
      setOut(""); setDone(false);
      const start = setTimeout(() => {
        let i = 0;
        const id = setInterval(() => {
          i += 1;
          setOut(text.slice(0, i));
          if (i >= text.length) { clearInterval(id); setDone(true); typedCacheRef.current.add(cacheKey); onDone?.(); }
        }, speed);
      }, startDelay);
      return () => { clearTimeout(start); };
    }, [text, speed, startDelay, cacheKey, alreadyTyped, onDone]);

    return (
      <span className={`nc-typing ${className || ""}`}>
        {out}
        {!done && <span className="nc-caret" aria-hidden="true">|</span>}
      </span>
    );
  });

  const PageBlock = memo(function PageBlock({ page, index, isCritical }: { page: Page; index: number; isCritical?: boolean }) {
    const renderTyped = (fieldKey: string, text: string, className: string) => {
      const key = `${page.id}-${fieldKey}`;
      if (typedCacheRef.current.has(key)) return <span className={className}>{text}</span>;
      return <TypingText text={text} className={className} cacheKey={key} />;
    };

    return (
      <figure className="nc-figure">

        <div className="nc-imageFrame">
          {page.videoMp4 ? (
            <Suspense fallback={<div className="nc-illustration" aria-hidden />}> 
              <LoopingVideoLazy
              srcMp4={page.videoMp4}
              srcWebm={page.videoWebm}
              poster={page.videoPoster}
              initialStart={page.videoInitialStart}
              initialEnd={page.videoInitialEnd}
              loopStart={page.videoLoopStart}
              loopEnd={page.videoLoopEnd}
              playbackRate={page.videoPlaybackRate}
              muted={true}
              autoPlay
              playsInline
              className="nc-video"
              onError={(e) => console.error('SunMoon video error:', (e.currentTarget as HTMLVideoElement).error)}
              />
            </Suspense>
          ) : page.illustration ? (
            <img
              src={page.illustration}
              alt=""
              className="nc-illustration"
              loading={isCritical ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={isCritical ? 'high' as any : undefined}
              width={isCritical ? 960 : 800}
              height={isCritical ? 540 : 450}
            />
          ) : (
            <div aria-hidden className="nc-illustration" />
          )}

          {/* corners themed for Sun & Moon */}
          <div className="nc-corner nc-corner--tl"><Sun size={14} /></div>
          <div className="nc-corner nc-corner--tr"><Sparkles size={14} /></div>
          <div className="nc-corner nc-corner--bl"><Sparkles size={14} /></div>
          <div className="nc-corner nc-corner--br"><Moon size={14} /></div>
        </div>

        <figcaption className="nc-caption">
          <p className="nc-narration">{renderTyped("narration", page.narration, "")}</p>
          {!!page.character && <p className="nc-dialog">{renderTyped("character", page.character, "")}</p>}
        </figcaption>
      </figure>
    );
  });

  // finale body class
  useEffect(() => {
    document.body.classList.toggle("nc-finale-open", isStoryComplete);
    return () => document.body.classList.remove("nc-finale-open");
  }, [isStoryComplete]);

  /* ===== checkpoint save/load ===== */
  const saveTimer = useRef<number | null>(null);
  const saveCheckpoint = async (forceComplete = false) => {
    try {
      const left = spreadStart;
      const right = spreadStart + 1;
      const currentPageNumber = rightUnlocked && storyPages[right] ? right + 1 : left + 1;

      const percent = forceComplete ? 100 : Math.floor((currentPageNumber / storyPages.length) * 100);

      if (!forceComplete) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        await new Promise<void>((resolve) => {
          saveTimer.current = window.setTimeout(() => resolve(), 180);
        });
      }

      await saveCheckpointAPI(BOOK_SLUG, {
        pageNumber: currentPageNumber,
        answersJson: answers,
        quizStateJson: {
          pendingSide,
          quizPageIndex,
          selectedAnswer,
          hasAnswered,
          rightUnlocked,
        },
        audioPositionSec: 0,
        percentComplete: percent,
      });
    } catch (e) {
      console.warn("[checkpoint] save failed:", e);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCheckpointAPI(BOOK_SLUG);
        const cp = data?.checkpoint;
        if (!cp || cancelled) return;

        const pageNumber = Math.max(1, Math.min(storyPages.length, cp.pageNumber ?? 1));
        const spread = Math.floor((pageNumber - 1) / 2) * 2;
        const unlockRight = pageNumber % 2 === 0;

        setSpreadStart(spread);
        setRightUnlocked(unlockRight);

        if (cp.answersJson && typeof cp.answersJson === "object") {
          setAnswers(cp.answersJson as Record<string, string>);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveCheckpoint().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leftPage = storyPages[spreadStart];
  const rightPage = storyPages[spreadStart + 1];

  /* --------- INLINE FULLSCREEN CENTERING --------- */
  const fsWrapStyle: React.CSSProperties | undefined = isFullscreen
    ? { position: "fixed", inset: 0, display: "grid", placeItems: "center", margin: 0, padding: 0, paddingTop: "3svh", zIndex: 3 }
    : undefined;

  const hardReset: React.CSSProperties | undefined = isFullscreen
    ? { position: "relative", inset: "auto", left: "auto", top: "auto", transform: "none", margin: 0 }
    : undefined;

  const fsBookStyle: React.CSSProperties | undefined = isFullscreen
    ? { ...hardReset, aspectRatio: "3 / 2", width: "min(1600px, 96vw)", height: "auto", maxHeight: "92svh", display: "block", transform: "translateY(2svh)" }
    : undefined;

  /* ===== render ===== */
  return (
    <div
      ref={rootRef}
      className={`min-h-screen flex flex-col sunmoon-theme ${isFullscreen ? "book-fullscreen-mode" : ""} ${isBooting ? "nc-booting" : ""}`}
    >

      {/* background */}
      <div className="nc-bg" style={{ backgroundImage: `url(${bg})` }} aria-hidden="true" />
      <div className="sm-stars" />

      {/* loader */}
      <div className={`nc-loader ${isBooting ? "" : "hidden"}`} aria-live="polite" aria-busy={isBooting}>
        <div className="nc-load-card">
          <div className="nc-brand"><div className="nc-beads" /></div>
          <div className="nc-title-xl">{i18n[lang].title}</div>
          <div className="nc-subtle">{i18n[lang].subtitle}</div>
          <div className="nc-progress" role="progressbar" aria-valuetext={i18n[lang].loading}><span /></div>
        </div>
      </div>

      <div className="sm-fore">
        {!isFullscreen && <Header variant="student" />}

        <main className={`flex-grow flex flex-col items-center justify-center ${isFullscreen ? "p-0" : "p-4 md:p-6"}`}>
          {!isFullscreen && (
            <div className="w-full max-w-7xl">
              <div className="flex justify-between items-center mb-6">
                <Link href="/student/twodanimation">
                  <Button variant="outline" className="sm-btn btn-white flex items-center gap-2">
                    <ChevronLeft size={16} /> {i18n[lang].backToStories}
                  </Button>
                </Link>
                <div className="text-center">
                  <h1 className="sm-heading text-2xl font-bold">{i18n[lang].title}</h1>
                  <div className="text-sm text-indigo-100/90">
                    {rightUnlocked && rightIndex < storyPages.length
                      ? i18n[lang].pageRangeOf(
                          String(Math.min(spreadStart + 1, storyPages.length)),
                          String(rightIndex + 1),
                          String(storyPages.length)
                        )
                      : i18n[lang].pageOf(
                          String(Math.min(spreadStart + 1, storyPages.length)),
                          String(storyPages.length)
                        )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {/* Language toggle */}
                  <Button
                    onClick={() => setLang((prev) => (prev === "en" ? "fil" : "en"))}
                    className="sm-btn btn-white"
                    aria-label={i18n[lang].langToggleAria}
                    title={i18n[lang].langToggleAria}
                  >
                    <Languages size={16} className="mr-2" />
                    {i18n[lang].langToggle(lang)}
                  </Button>

                  <Button onClick={toggleFullscreen} className="sm-btn btn-white">
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                  </Button>
                  <Button onClick={() => setIsMuted((v) => !v)} className="sm-btn btn-white">
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* book */}
          <div className={`popup-open-book-wrapper relative mx-auto ${entered ? "nc-enter nc-enter-active" : "nc-enter"}`}>
            <div className="popup-book-container">
              <div className="popup-flip-book-container" key={isFullscreen ? "fs" : "norm"}>
                <div className={`popup-book-wrapper ${playOpen ? "nc-opening" : ""}`}>
                  <div className="popup-book-fold" />

                  {/* left */}
                  <div className="popup-page-left">
                    <div className="story-content p-6">
                      {leftPage && <PageBlock page={leftPage} index={leftIndex} isCritical={leftIndex===0} />}
                      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs text-indigo-100/80">{leftIndex + 1}</div>
                    </div>
                  </div>

                  {/* right */}
                  <div className={`popup-page-right ${flipRightNow ? "flipped" : ""}`}>
                    <div className="story-content p-6 text-center">
                      {rightUnlocked && rightPage ? (
                        <>
                          <PageBlock page={rightPage} index={rightIndex} />
                          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs text-indigo-100/80">{rightIndex + 1}</div>
                        </>
                      ) : (
                        <div className="h-full flex items-center justify-center opacity-40 text-sm italic">
                          <Sparkles className="mr-2" size={16} /> {i18n[lang].unlockHint}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* nav */}
                  <button
                    className="popup-page-nav-left"
                    onClick={handlePrev}
                    disabled={isFlipping || spreadStart === 0}
                    aria-label="Previous"
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button
                    className="popup-page-nav-right"
                    onClick={handleNext}
                    disabled={isFlipping || pendingSide !== null}
                    aria-label="Next"
                  >
                    <ChevronRight size={24} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* quiz dialog */}
          <Dialog
            open={pendingSide !== null}
            onOpenChange={(open) => { if (!open) { setPendingSide(null); setQuizPageIndex(null); resetQuiz(); } }}
          >
            <DialogContent className="max-w-md" aria-describedby="sm-quiz-desc">
              <DialogHeader>
                <DialogTitle className="sm-heading" id="sm-quiz-title">{i18n[lang].question}</DialogTitle>
                <DialogDescription id="sm-quiz-desc">
                  {quizPageIndex != null && storyPages[quizPageIndex]?.quiz?.question
                    ? storyPages[quizPageIndex]?.quiz?.question
                    : 'Answer the question to continue the story.'}
                </DialogDescription>
              </DialogHeader>

              <RadioGroup value={selectedAnswer} onValueChange={setSelectedAnswer} aria-labelledby="sm-quiz-title">
                {quizPageIndex != null && storyPages[quizPageIndex]?.quiz?.options?.map((opt) => (
                  <div key={opt.slug} className="flex items-center space-x-2 my-2">
                    <RadioGroupItem value={opt.slug} id={`opt-${opt.slug}`} />
                    <Label htmlFor={`opt-${opt.slug}`}>{opt.text}</Label>
                  </div>
                ))}
              </RadioGroup>

              {hasAnswered && (
                <div
                  className={`mt-4 p-2 rounded text-sm font-semibold ${isCorrect ? "text-green-400" : "text-red-400"}`}
                  role="status"
                  aria-live="polite"
                >
                  {feedback}
                </div>
              )}

              <DialogFooter className="mt-4 gap-2">
                {hasAnswered ? (
                  isCorrect ? (
                    <Button onClick={continueAfterCorrect} className="sm-btn" style={{ background: "linear-gradient(180deg, var(--sm-amber), var(--sm-amber-deep))", color: "#111827" }}>
                      <Check size={16} className="mr-2" /> {i18n[lang].continue}
                    </Button>
                  ) : (
                    <Button onClick={tryAgain} className="sm-btn" style={{ background: "#4338ca", color: "white" }}>
                      <RefreshCw size={16} className="mr-2" /> {i18n[lang].tryAgain}
                    </Button>
                  )
                ) : (
                  <Button onClick={handleAnswerSubmit} disabled={!selectedAnswer} className="sm-btn" style={{ background: "#4f46e5", color: "white" }}>
                    {i18n[lang].submit}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* finale */}
          <Dialog open={isStoryComplete} onOpenChange={setIsStoryComplete}>
            <DialogContent className="max-w-md nc-finale-box nc-finale-lift !max-h-none !h-auto !overflow-visible">
              <DialogHeader>
                <div className="nc-finale-badge" aria-hidden>
                  <span className="nc-finale-moon" />
                  <span className="nc-finale-beads" />
                </div>
                <DialogTitle className="sm-heading">{i18n[lang].finaleThanksTitle}</DialogTitle>
                <DialogDescription>
                  {i18n[lang].finaleThanksDesc}
                </DialogDescription>
              </DialogHeader>

              <div className="nc-comb-divider" aria-hidden />

              <div className="text-sm text-indigo-100/90 space-y-2">
                <p><strong>{i18n[lang].reflectionHeader}</strong></p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{i18n[lang].reflectionQ1}</li>
                  <li>{i18n[lang].reflectionQ2}</li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-2 mt-5 justify-between">
                <Button onClick={restartStory} className="sm-btn nc-finale-btn-primary">
                  <RefreshCw size={16} className="mr-2" /> {i18n[lang].readAgain}
                </Button>

                <Link href="/student/twodanimation">
                  <Button
                    className="sm-btn nc-finale-btn-outline"
                    onClick={() => {
                      // reset everything before leaving shelf
                      restartStory();
                      resetCheckpointAPI(BOOK_SLUG).catch(() => {});
                    }}
                  >
                    <Home size={16} className="mr-2" /> {i18n[lang].backToShelf}
                  </Button>
                </Link>
              </div>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </div>
  );
}
