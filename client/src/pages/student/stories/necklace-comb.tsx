// src/pages/student/stories/necklace-comb.tsx
import { useState, useEffect, useRef, memo } from 'react';
import { Link, useLocation } from 'wouter';
import Header from "@/components/layout/Header";
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Home, Volume2, VolumeX, Check, Maximize, Minimize, RefreshCw, Sparkles, Moon, Gem, Languages } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
// Lazy Live2D: defer heavy model runtime until user explicitly enables it
import { lazy, Suspense } from 'react';
const Live2DViewerLazy = lazy(() => import('@/components/Live2DViewer'));
import backgroundVideo from '@/assets/bookanimation/bg.mp4';
import '@/pages/student/stories/2danimatedstorybook.css';
import '@/pages/student/stories/live2d.css';
import '@/pages/student/stories/video.css';
import LoopingVideo from "@/components/LoopingVideo";
import './necklace-comb.css';
// checkpoint + completion APIs (missing earlier)
import { getCheckpoint as getCheckpointAPI, saveCheckpoint as saveCheckpointAPI, resetCheckpoint as resetCheckpointAPI } from '@/lib/stories/checkpointClient';
import { markBookComplete as markBookCompleteAPI } from '@/lib/clients/completeClient';

// ===== types & constants =====
type Lang = 'en' | 'fil';
const LANG_KEY = 'ags.lang';
type QAOption = { slug: string; text: string; correct: boolean };
type Quiz = { questionSlug: string; question: string; options: QAOption[] };
type Page = { id: string; narration?: string; character?: string; illustration?: string; videoMp4?: string; videoWebm?: string; videoPoster?: string; videoInitialStart?: number; videoInitialEnd?: number; videoLoopStart?: number; videoLoopEnd?: number; videoPlaybackRate?: number; live2dModelUrl?: string; live2dEntryMotion?: string; live2dIdleMotion?: string; live2dScale?: number; live2dFitPadding?: number; live2dFitMode?: string; live2dOffsetX?: number; live2dOffsetY?: number; live2dBgModelUrl?: string; live2dBgEntryMotion?: string; live2dBgIdleMotion?: string; live2dBgScale?: number; live2dBgOffsetX?: number; live2dBgOffsetY?: number; quiz?: Quiz; };

const detectInitialLang = (): Lang => {
  try {
    const saved = (localStorage.getItem(LANG_KEY) || '').toLowerCase();
    if (saved === 'en' || saved === 'fil') return saved as Lang;
  } catch {}
  const nav = (navigator.language || (navigator as any).userLanguage || '').toLowerCase();
  const langs = (navigator.languages || []).map(l => l.toLowerCase());
  const isPH = nav.endsWith('-ph') || langs.some(l => l.endsWith('-ph'));
  const anyFil = [nav, ...langs].some(l => l.startsWith('fil') || l.startsWith('tl'));
  if (isPH || anyFil) return 'fil';
  return 'en';
};

const useLang = () => {
  const [lang, setLang] = useState<Lang>(detectInitialLang());
  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch {} }, [lang]);
  return { lang, setLang };
};

const i18n = {
  en: { title: 'The Necklace and the Comb', loaderSub: 'Setting the stage for a starry tale…', backToStories: 'Back to Stories', pageOf: (a:string,b:string)=>`Page ${a} of ${b}`, pageRangeOf:(a:string,b:string,c:string)=>`Page ${a}–${b} of ${c}`, unlockHint:'unlock the next page by answering the question (if any)', question:'Question', submit:'Submit', tryAgain:'Try Again', continue:'Continue', fbCorrect:'Correct! You may continue.', fbWrong:'Oops, try again.', readAgain:'Read Again from Start', backToShelf:'Back to Story Shelf', finaleTitle:'Thanks for reading! 🌙✨', finaleDesc:'We walked with Maria from the rice fields to the night sky. Her comb became the moon, and her necklace became the stars. Thank you for reading with us—your curiosity made the sky shine brighter.', reflectionHeader:'Quick reflection:', reflectionQ1:'What did Maria learn about focus and listening?', reflectionQ2:'Which part of the story felt most magical to you?', langToggle:(l:Lang)=> (l==='en'?'FIL':'EN'), langToggleAria:'Toggle language', loading:'Loading' },
  fil: { title: 'Ang Kuwintas at ang Suklay', loaderSub: 'Inihahanda ang entablado para sa kuwentong bituin…', backToStories: 'Bumalik sa Mga Kuwento', pageOf:(a:string,b:string)=>`Pahina ${a} ng ${b}`, pageRangeOf:(a:string,b:string,c:string)=>`Pahina ${a}–${b} ng ${c}`, unlockHint:'i-unlock ang susunod na pahina sa pagsagot ng tanong (kung meron)', question:'Tanong', submit:'Isumite', tryAgain:'Subukan Muli', continue:'Magpatuloy', fbCorrect:'Tama! Maaari ka nang magpatuloy.', fbWrong:'Ay naku, subukan muli.', readAgain:'Basahin Muli Mula Simula', backToShelf:'Bumalik sa Estante ng Kuwento', finaleTitle:'Salamat sa Pagbasa! 🌙✨', finaleDesc:'Nakisalamuha tayo kay Maria mula bukirin hanggang kalangitan. Naging buwan ang kanyang suklay, at naging mga bituin ang kanyang kuwintas. Salamat sa pagbabasa— mas kumislap ang langit dahil sa iyong kuryusidad.', reflectionHeader:'Mabilis na pagninilay:', reflectionQ1:'Ano ang natutunan ni Maria tungkol sa pagtuon at pakikinig?', reflectionQ2:'Aling bahagi ng kuwento ang pinakamahiwaga para sa iyo?', langToggle:(l:Lang)=> (l==='en'?'FIL':'EN'), langToggleAria:'Palitan ang wika', loading:'Naglo-load' }
} as const;

async function loadPages(lang: Lang): Promise<Page[]> {
  const mod = await import(`@/content/stories/necklace-comb.${lang}.json`);
  const arr = (mod.default || []) as any[];
  return arr.map(p => ({
    ...p,
    videoMp4: p.videoMp4 ? withBase(p.videoMp4) : undefined,
    videoWebm: p.videoWebm ? withBase(p.videoWebm) : undefined,
    videoPoster: p.videoPoster ? withBase(p.videoPoster) : undefined,
  }));
}

function withBase(path: string){ return '/' + path.replace(/^\//,''); }
/* ========= COMPONENT ========= */
export default function NecklaceCombStory() {
  const { lang, setLang } = useLang();

  // book identity (adjust ID if you have a numeric one server-side)
  const BOOK_SLUG = 'necklace-comb';
  const BOOK_ID: number | undefined = undefined;
  const LIVE2D_SIZE_CLASS = ''; // customize if you had a specific size class previously

  const [spreadStart, setSpreadStart] = useState(0);
  const [rightUnlocked, setRightUnlocked] = useState(false);
  const [pendingSide, setPendingSide] = useState<null | 'left' | 'right'>(null);
  const [quizPageIndex, setQuizPageIndex] = useState<number | null>(null);

  // Start muted so browsers allow autoplay; user can unmute via the volume button
  const [isMuted, setIsMuted] = useState(true);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isFlipping, setIsFlipping] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStoryComplete, setIsStoryComplete] = useState(false);
  const [flipRightNow, setFlipRightNow] = useState(false);
  // Defer loading heavy Live2D runtime until user explicitly enables per page view
  const [enableLive2D, setEnableLive2D] = useState(false);

  // Loader + intro
  const [isBooting, setIsBooting] = useState(true);
  const [entered, setEntered] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);

  // Dynamic pages
  const [storyPages, setStoryPages] = useState<Page[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setPagesLoading(true);
    loadPages(lang).then(p => { if(!cancelled){ setStoryPages(p); setPagesLoading(false);} }).catch(()=>{ if(!cancelled) setPagesLoading(false); });
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

  // quiz local UI state
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [feedback, setFeedback] = useState('');

  const rootRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<HTMLDivElement | null>(null);
  const typedCacheRef = useRef<Set<string>>(new Set());

  const [, navigate] = useLocation();

  // fullscreen tracking
  useEffect(() => {
    const onFsChange = () => {
      const on = !!document.fullscreenElement;
      setIsFullscreen(on);
      document.body.classList.toggle('book-fullscreen-mode', on);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // keyboard arrows
  const leftIndex = spreadStart;
  const rightIndex = spreadStart + 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pendingSide || isFlipping) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); handleNext(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handlePrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingSide, isFlipping, spreadStart, rightUnlocked]);

  const pagesWithLive2D = storyPages;

  // ====== Fullscreen toggle ======
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' } as any);
      } else {
        await document.exitFullscreen();
      }
    } catch {
      const v = !isFullscreen;
      setIsFullscreen(v);
      document.body.classList.toggle('book-fullscreen-mode', v);
    }
  };

  /* ====== QUIZ STATE ====== */
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // ====== Navigation with conditional quiz gating ======
  const handleNext = () => {
    if (pendingSide || isFlipping) return;

    if (rightIndex >= pagesWithLive2D.length) {
      setIsStoryComplete(true);
      markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG).catch(() => {});
      saveCheckpoint(true).catch(() => {});
      return;
    }

    const goingSide: 'left' | 'right' = rightUnlocked ? 'right' : 'left';
    const targetIndex = goingSide === 'left' ? leftIndex : rightIndex;

    const targetHasQuiz = !!pagesWithLive2D[targetIndex]?.quiz;
    if (targetHasQuiz) {
      setPendingSide(goingSide);
      setQuizPageIndex(targetIndex);
      return;
    }

    if (goingSide === 'left') {
      setRightUnlocked(true);
      saveCheckpoint().catch(() => {});
    } else {
      setIsFlipping(true);
      setFlipRightNow(true);
      setTimeout(() => {
        const nextLeft = spreadStart + 2;
        if (nextLeft >= pagesWithLive2D.length) {
          setIsStoryComplete(true);
          markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG).catch(() => {});
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

  // ====== Quiz helpers ======
  const resetQuiz = () => { setSelectedAnswer(''); setHasAnswered(false); setIsCorrect(false); setFeedback(''); };

  const handleAnswerSubmit = () => {
    if (quizPageIndex == null) return;
    const q = pagesWithLive2D[quizPageIndex]?.quiz;
    if (!q) return;

    const correct = q.options.find(o => o.slug === selectedAnswer)?.correct;
    const ok = !!correct;
    setIsCorrect(ok);
    setHasAnswered(true);
    setFeedback(ok ? i18n[lang].fbCorrect : i18n[lang].fbWrong);

    if (ok) {
      setAnswers((prev) => ({ ...prev, [q.questionSlug]: selectedAnswer }));
    }
  };

  const tryAgain = () => resetQuiz();

  const continueAfterCorrect = () => {
    if (!isCorrect || pendingSide == null) return;
    if (pendingSide === 'left') {
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
        if (nextLeft >= pagesWithLive2D.length) {
          setIsStoryComplete(true);
          markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG).catch(() => {});
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

  const toggleMute = () => {
    setIsMuted(v => {
      const next = !v;
      const el = bgAudioRef.current;
      if (el) {
        el.muted = next; // reflect immediately
        if (!next) {
          // attempt playback when unmuting; catch to avoid uncaught promise in some browsers
            el.play().catch(() => {});
        }
      }
      return next;
    });
  };
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

  const backToShelf = () => {
    restartStory();
    navigate('/student/twodanimation');
  };

  /* ========= TypingText helper ========= */
  const TypingText = memo(function TypingTextMemo({
    text, className, speed = 45, startDelay = 120, cacheKey, onDone,
    globalCache,
  }: {
    text: string;
    className?: string;
    speed?: number;
    startDelay?: number;
    cacheKey: string;
    onDone?: () => void;
    globalCache: React.MutableRefObject<Set<string>>;
  }) {
    const alreadyTyped = globalCache.current.has(cacheKey);
    const [out, setOut] = useState(alreadyTyped ? text : '');
    const [done, setDone] = useState(alreadyTyped);

    useEffect(() => {
      if (alreadyTyped) return;
      setOut(''); setDone(false);

      const start = setTimeout(() => {
        let i = 0;
        const id = setInterval(() => {
          i += 1;
          setOut(text.slice(0, i));
          if (i >= text.length) {
            clearInterval(id);
            setDone(true);
            globalCache.current.add(cacheKey);
            onDone?.();
          }
        }, speed);
      }, startDelay);

      return () => { clearTimeout(start); };
    }, [text, speed, startDelay, cacheKey, alreadyTyped, onDone, globalCache]);

    return (
      <span className={`nc-typing ${className || ''}`}>
        {out}
        {!done && <span className="nc-caret" aria-hidden="true">|</span>}
      </span>
    );
  });

  /* ========= PageBlock ========= */
  const PageBlock = ({ page }: { page: Page }) => {
  const renderTyped = (fieldKey: string, text: string, className: string) => {
    const key = `${page.id}-${fieldKey}`;
    if (typedCacheRef.current.has(key)) return <span className={className}>{text}</span>;

    return (
      <TypingText
        text={text}
        className={className}
        cacheKey={key}
        globalCache={typedCacheRef}
      />
    );
  };

  const frameClass =
    page.live2dModelUrl
      ? `nc-imageFrame live2d-frame ${LIVE2D_SIZE_CLASS}`
      : "nc-imageFrame";

  return (
    <figure className="nc-figure">
      <div className={frameClass}>
        {page.videoMp4 ? (
          <LoopingVideo
            srcMp4={page.videoMp4}
            srcWebm={page.videoWebm}
            poster={page.videoPoster}         // ✅ show a poster until first frame
            initialStart={page.videoInitialStart}
            initialEnd={page.videoInitialEnd}
            loopStart={page.videoLoopStart}
            loopEnd={page.videoLoopEnd}
            playbackRate={page.videoPlaybackRate}
            muted={true}                      // ✅ required for autoplay
            autoPlay                          // ✅ pass down to <video>
            playsInline                       // ✅ prevent fullscreen on mobile
            className="nc-video"
            onError={(e) =>
              console.error("Video error:", (e.currentTarget as HTMLVideoElement).error)
            }
          />
        ) : page.live2dModelUrl ? (
          <div className="nc-live2d">
            {enableLive2D ? (
              <Suspense fallback={<div className="text-xs text-gray-400 p-4">Loading animation…</div>}>
                <Live2DViewerLazy
                  modelUrl={page.live2dModelUrl}
                  entryMotion={page.live2dEntryMotion}
                  idleMotion={page.live2dIdleMotion}
                  scale={page.live2dScale}
                  fitPadding={page.live2dFitPadding}
                  fitMode={page.live2dFitMode as any}
                  offsetX={page.live2dOffsetX}
                  offsetY={page.live2dOffsetY}
                  bgModelUrl={page.live2dBgModelUrl}
                  bgEntryMotion={page.live2dBgEntryMotion}
                  bgIdleMotion={page.live2dBgIdleMotion}
                  bgScale={page.live2dBgScale}
                  bgOffsetX={page.live2dBgOffsetX}
                  bgOffsetY={page.live2dBgOffsetY}
                  bgFitMode="cover"
                />
              </Suspense>
            ) : (
              <button
                type="button"
                onClick={() => setEnableLive2D(true)}
                className="w-full h-full flex items-center justify-center text-xs text-gray-500 hover:text-gray-700 transition"
              >
                Enable interactive animation
              </button>
            )}
          </div>
        ) : (
          <img src={page.illustration} alt="" className="nc-illustration" width={1280} height={720} loading="lazy" />
        )}

        {/* decorative corners */}
        <div className="nc-corner nc-corner--tl"><Gem size={14} /></div>
        <div className="nc-corner nc-corner--tr"><Sparkles size={14} /></div>
        <div className="nc-corner nc-corner--bl"><Sparkles size={14} /></div>
        <div className="nc-corner nc-corner--br"><Moon size={14} /></div>
      </div>

      <figcaption className="nc-caption">
        {page.narration && (
          <p className="nc-narration">
            {renderTyped("narration", page.narration, "")}
          </p>
        )}
        {!!page.character && (
          <p className="nc-dialog">
            {renderTyped("character", page.character, "")}
          </p>
        )}
      </figcaption>
    </figure>
  );
  };

  /* --------- INLINE FULLSCREEN CENTERING STYLES --------- */
  const fsWrapStyle: React.CSSProperties | undefined = isFullscreen
    ? { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', margin: 0, padding: 0, paddingTop: '3svh', zIndex: 3 }
    : undefined;

  const hardReset: React.CSSProperties | undefined = isFullscreen
    ? { position: 'relative', inset: 'auto', left: 'auto', top: 'auto', transform: 'none', margin: 0 }
    : undefined;

  const fsBookStyle: React.CSSProperties | undefined = isFullscreen
    ? { ...hardReset, aspectRatio: '3 / 2', width: 'min(1600px, 96vw)', height: 'auto', maxHeight: '92svh', display: 'block', transform: 'translateY(2svh)' }
    : undefined;

  // === Finale helper
  useEffect(() => {
    document.body.classList.toggle('nc-finale-open', isStoryComplete);
    return () => document.body.classList.remove('nc-finale-open');
  }, [isStoryComplete]);

  /* ====== CHECKPOINT SAVE/LOAD ====== */
  const saveTimer = useRef<number | null>(null);
  const saveCheckpoint = async (forceComplete = false) => {
    try {
      const leftIndex = spreadStart;
      const rightIndex = spreadStart + 1;
      const currentPageNumber =
        rightUnlocked && pagesWithLive2D[rightIndex] ? (rightIndex + 1) : (leftIndex + 1);

      const percent = forceComplete
        ? 100
        : Math.floor((currentPageNumber / pagesWithLive2D.length) * 100);

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
      console.warn('[checkpoint] save failed:', e);
    }
  };

  // LOAD checkpoint on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCheckpointAPI(BOOK_SLUG);
        const cp = data?.checkpoint;
        if (!cp || cancelled) return;

        const pageNumber = Math.max(1, Math.min(pagesWithLive2D.length, cp.pageNumber ?? 1));
        const spread = Math.floor((pageNumber - 1) / 2) * 2;
        const unlockRight = pageNumber % 2 === 0;

        setSpreadStart(spread);
        setRightUnlocked(unlockRight);

        if (cp.answersJson && typeof cp.answersJson === 'object') {
          const obj = cp.answersJson as Record<string, string>;
          setAnswers(obj);
        }
      } catch {
        // first-time readers may have no checkpoint
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // gentle initial checkpoint
  useEffect(() => {
    saveCheckpoint().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure audio starts playing (muted) after component mounts & pages load
  useEffect(() => {
    const el = bgAudioRef.current;
    if (!el) return;
    el.muted = isMuted;
    if (!isMuted) {
      el.play().catch(() => {});
    } else {
      // still call play() muted to keep it primed in some browsers
      el.play().catch(() => {});
    }
  }, [isMuted]);

  return (
    <div
      ref={rootRef}
      className={`necklace-comb-page min-h-screen flex flex-col kid-theme ${isFullscreen ? 'book-fullscreen-mode' : ''} ${isBooting ? 'nc-booting' : ''}`}
    >
      {/* Background music */}
      <audio
        ref={bgAudioRef}
        src="/audio/twinkle.mp3"
        loop
        preload="auto"
        // muted attribute bound dynamically via ref/effect; keep default muted for SSR hydration safety
        muted
        aria-label="Background music"
        style={{ display: 'none' }}
      />

      {/* Background layers */}
      <div className="nc-bg-video-wrap" aria-hidden="true">
        <LoopingVideo
          srcMp4={backgroundVideo}   // your imported mp4
          muted
          autoPlay
          playsInline
          loop
          className="nc-bg-video"
        />
      </div>
      <div className="nc-spark-layer" />
      <div className="nc-pearl-arc" />

      {/* Loader */}
      <div className={`nc-loader ${isBooting ? '' : 'hidden'}`} aria-live="polite" aria-busy={isBooting}>
        <div className="nc-load-card">
          <div className="nc-brand"><div className="nc-beads" /></div>
          <div className="nc-title-xl">{i18n[lang].title}</div>
          <div className="nc-subtle">{i18n[lang].loaderSub}</div>
          <div className="nc-progress" role="progressbar" aria-valuetext={i18n[lang].loading}><span /></div>
        </div>
      </div>

      <div className="kid-fore">
        {!isFullscreen && <Header variant="student" />}

        <main className={`flex-grow flex flex-col items-center justify-center ${isFullscreen ? 'p-0' : 'p-4 md:p-6'}`}>
          {!isFullscreen && (
            <div className="w-full max-w-7xl">
              <div className="flex justify-between items-center mb-6">
                <Link href="/student/twodanimation">
                  <Button variant="outline" className="kid-btn btn-solid-white flex items-center gap-2">
                    <ChevronLeft size={16} /> {i18n[lang].backToStories}
                  </Button>
                </Link>
                <div className="text-center">
  <div className="nc-title-wrap">
    <h1 className="kid-heading nc-title-fancy">
      <span className="nc-title-shine">{i18n[lang].title}</span>
      <span className="nc-title-beads" aria-hidden="true" />
    </h1>

    <div className="nc-title-sub nc-title-glow">
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
</div>
                <div className="flex gap-2">
                  {/* Language toggle */}
                  <Button
                    onClick={() => setLang(l => (l === 'en' ? 'fil' : 'en'))}
                    className="kid-btn btn-solid-white"
                    aria-label={i18n[lang].langToggleAria}
                    title={i18n[lang].langToggleAria}
                  >
                    <Languages size={16} className="mr-2" />
                    {i18n[lang].langToggle(lang)}
                  </Button>

                  <Button onClick={toggleFullscreen} className="kid-btn btn-solid-white">
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                  </Button>
                  <Button onClick={() => setIsMuted(v=>!v)} className="kid-btn btn-solid-white">
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Book */}
          <div
            ref={bookRef}
            className={`popup-open-book-wrapper relative mx-auto ${entered ? 'nc-enter nc-enter-active' : 'nc-enter'}`}
            style={fsWrapStyle}
          >
            <div className="popup-book-container" style={hardReset}>
              <div
                className="popup-flip-book-container"
                key={isFullscreen ? 'fs' : 'norm'}
                style={fsBookStyle}
              >
                <div className={`popup-book-wrapper ${playOpen ? 'nc-opening' : ''}`}>
                  <div className="popup-book-fold" />
                  {/* Skeleton while pages are loading (after boot) */}
                  {(!isBooting && pagesLoading) && (
                    <div className="nc-skeleton-spread" aria-hidden>
                      <div className="nc-skeleton-page" />
                      <div className="nc-skeleton-page" />
                    </div>
                  )}
                  {/* Left page */}
                  <div className="popup-page-left">
                    <div className="story-content p-6">
                      {!pagesLoading && pagesWithLive2D[leftIndex] && <PageBlock page={pagesWithLive2D[leftIndex]} />}
                      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs">
                        {leftIndex + 1}
                      </div>
                    </div>
                  </div>

                  {/* Right page */}
                  <div className={`popup-page-right ${flipRightNow ? 'flipped' : ''}`}>
                    <div className="story-content p-6 text-center">
                      {!pagesLoading && rightUnlocked && pagesWithLive2D[rightIndex] ? (
                        <>
                          <PageBlock page={pagesWithLive2D[rightIndex]} />
                          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs">
                            {rightIndex + 1}
                          </div>
                        </>
                      ) : (
                        <div className="h-full flex items-center justify-center opacity-40 text-sm italic">
                          <Sparkles className="mr-2" size={16} /> {i18n[lang].unlockHint}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Nav buttons */}
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
                    disabled={isFlipping || pendingSide !== null || pagesLoading}
                    aria-label="Next"
                  >
                    <ChevronRight size={24} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Question dialog */}
          <Dialog open={pendingSide !== null} onOpenChange={(open) => { if (!open) { setPendingSide(null); setQuizPageIndex(null); resetQuiz(); } }}>
            <DialogContent className="max-w-md" aria-describedby="quiz-dialog-desc" aria-labelledby="quiz-dialog-title">
              <DialogHeader>
                <DialogTitle className="kid-heading" id="quiz-dialog-title">
                  {i18n[lang].question}
                </DialogTitle>
                <DialogDescription id="quiz-dialog-desc">
                  {quizPageIndex != null && pagesWithLive2D[quizPageIndex]?.quiz?.question
                    ? pagesWithLive2D[quizPageIndex]?.quiz?.question
                    : 'Answer the question to unlock the next page.'}
                </DialogDescription>
              </DialogHeader>

              <RadioGroup value={selectedAnswer} onValueChange={setSelectedAnswer} aria-labelledby="quiz-dialog-title">
                {quizPageIndex != null && pagesWithLive2D[quizPageIndex]?.quiz?.options?.map((opt) => (
                  <div key={opt.slug} className="flex items-center space-x-2 my-2">
                    <RadioGroupItem value={opt.slug} id={`opt-${opt.slug}`} />
                    <Label htmlFor={`opt-${opt.slug}`}>{opt.text}</Label>
                  </div>
                ))}
              </RadioGroup>

              {hasAnswered && (
                <div
                  className={`mt-4 p-2 rounded text-sm font-semibold ${
                    isCorrect ? 'text-green-600' : 'text-red-600'
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {feedback}
                </div>
              )}

              <DialogFooter className="mt-4 gap-2">
                {hasAnswered ? (
                  isCorrect ? (
                    <Button onClick={continueAfterCorrect} className="kid-btn bg-green-600 hover:bg-green-700 text-white">
                      <Check size={16} className="mr-2" /> {i18n[lang].continue}
                    </Button>
                  ) : (
                    <Button onClick={tryAgain} className="kid-btn bg-blue-600 hover:bg-blue-700 text-white">
                      <RefreshCw size={16} className="mr-2" /> {i18n[lang].tryAgain}
                    </Button>
                  )
                ) : (
                  <Button onClick={handleAnswerSubmit} disabled={!selectedAnswer} className="kid-btn bg-blue-700 hover:bg-blue-600 text-white">
                    {i18n[lang].submit}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Story complete */}
          <Dialog open={isStoryComplete} onOpenChange={setIsStoryComplete}>
            <DialogContent className="max-w-md nc-finale-box nc-finale-lift !max-h-none !h-auto !overflow-visible">
              <DialogHeader>
                <div className="nc-finale-badge" aria-hidden>
                  <span className="nc-finale-moon" />
                  <span className="nc-finale-beads" />
                </div>
                <DialogTitle className="kid-heading">{i18n[lang].finaleTitle}</DialogTitle>
                <DialogDescription>
                  {i18n[lang].finaleDesc}
                </DialogDescription>
              </DialogHeader>

              <div className="nc-comb-divider" aria-hidden />

              <div className="text-sm text-slate-700 space-y-2">
                <p><strong>{i18n[lang].reflectionHeader}</strong></p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{i18n[lang].reflectionQ1}</li>
                  <li>{i18n[lang].reflectionQ2}</li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-2 mt-5 justify-between">
                <Button onClick={restartStory} className="kid-btn nc-finale-btn-primary">
                  <RefreshCw size={16} className="mr-2" /> {i18n[lang].readAgain}
                </Button>
                <Button onClick={backToShelf} className="kid-btn nc-finale-btn-outline">
                  <Home size={16} className="mr-2" /> {i18n[lang].backToShelf}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </div>
  );
}
