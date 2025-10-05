// Bernardo Carpio story – refactored to match two-page flip structure like necklace-comb & sun-moon
import { useState, useEffect, useRef, memo } from 'react';
import { Link } from 'wouter';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Home, Volume2, VolumeX, Check, RefreshCw, Maximize, Minimize, Sparkles, Mountain, Languages } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import LoopingVideo from '@/components/LoopingVideo';
import '@/pages/student/stories/bernardo-carpio.css';
import '@/pages/student/stories/2danimatedstorybook.css';
import { getCheckpoint as getCheckpointAPI, saveCheckpoint as saveCheckpointAPI, resetCheckpoint as resetCheckpointAPI } from '@/lib/stories/checkpointClient';
import { markBookComplete as markBookCompleteAPI } from '@/lib/clients/completeClient';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

/* ===== meta ===== */
const BOOK_SLUG = 'bernardo-carpio';
const BOOK_ID: number | undefined = undefined;
// Build tag helps verify production has the latest bundle.
const BUILD_TAG = 'bernardo-carpio-v2025-10-05-01';
console.log('[bernardo-carpio] BUILD_TAG =', BUILD_TAG);

/* ===== types ===== */
type Lang = 'en' | 'fil';
type QAOption = { slug: string; text: string; correct: boolean };
type Quiz = { questionSlug: string; question: string; options: QAOption[] };
type Page = { id: string; title?: string; narration: string; character?: string; illustration?: string; videoMp4?: string; videoWebm?: string; videoPoster?: string; quiz?: Quiz };

/* ===== language ===== */
const LANG_KEY = 'ags.lang';
const detectInitialLang = (): Lang => {
  try { const saved = (localStorage.getItem(LANG_KEY)||'').toLowerCase(); if (saved==='en'||saved==='fil') return saved as Lang; } catch {}
  const nav = (navigator.language || (navigator as any).userLanguage || '').toLowerCase();
  const langs = (navigator.languages||[]).map(l=>l.toLowerCase());
  const anyFil = [nav,...langs].some(l=> l.startsWith('fil') || l.startsWith('tl'));
  if (anyFil || nav.endsWith('-ph') || langs.some(l=>l.endsWith('-ph'))) return 'fil';
  return 'en';
};
const useLang = () => { const [lang,setLang]=useState<Lang>(detectInitialLang()); useEffect(()=>{try{localStorage.setItem(LANG_KEY,lang);}catch{}},[lang]); return {lang,setLang}; };

const i18n = {
  en: { title: 'Bernardo Carpio', sub: 'The legend of strength beneath the mountains…', backToStories:'Back to Stories', pageOf:(a:string,b:string)=>`Page ${a} of ${b}`, pageRangeOf:(a:string,b:string,c:string)=>`Page ${a}–${b} of ${c}`, unlockHint:'unlock the next page by answering the question (if any)', question:'Question', submit:'Submit', tryAgain:'Try Again', continue:'Continue', fbCorrect:'Correct! You may continue.', fbWrong:'Not quite—try again.', finaleTitle:'Story Complete! 💎', finaleDesc:'You have finished the tale of Bernardo Carpio, the legendary hero trapped beneath the mountains. Remember the wisdom of patience and good advice.', readAgain:'Read Again from Start', backToShelf:'Back to Story Shelf', langToggle:(l:Lang)=> (l==='en'?'FIL':'EN'), langToggleAria:'Toggle language', loading:'Loading' },
  fil: { title: 'Bernardo Carpio', sub: 'Ang alamat ng lakas sa ilalim ng bundok…', backToStories:'Bumalik sa mga Kuwento', pageOf:(a:string,b:string)=>`Pahina ${a} ng ${b}`, pageRangeOf:(a:string,b:string,c:string)=>`Pahina ${a}–${b} ng ${c}`, unlockHint:'i-unlock ang susunod na pahina sa pagsagot ng tanong (kung meron)', question:'Tanong', submit:'Isumite', tryAgain:'Subukan Muli', continue:'Magpatuloy', fbCorrect:'Tama! Maaari ka nang magpatuloy.', fbWrong:'Hindi tama—subukan muli.', finaleTitle:'Tapos na ang Kuwento! 💎', finaleDesc:'Natapos mo ang alamat ni Bernardo Carpio, ang bayaning nakakulong sa ilalim ng bundok. Tandaan ang karunungan ng pagtitiyaga at pakikinig sa mabuting payo.', readAgain:'Basahin Muli Mula Simula', backToShelf:'Bumalik sa Estante', langToggle:(l:Lang)=> (l==='en'?'FIL':'EN'), langToggleAria:'Palitan ang wika', loading:'Naglo-load' }
} as const;

/* ===== dynamic pages loader (supports JSON per language) ===== */
// NOTE: In production builds, fully dynamic template imports like
//   import(`.../bernardo-carpio.${lang}.json`)
// are NOT statically analyzable, so Vite may exclude the JSON and the
// runtime will fail & fall back. We instead use import.meta.glob with
// eager loading so both language JSON files are guaranteed to be bundled.
// Use relative path (no alias) so Vite certainly matches during build.
// __dirname equivalent isn't available; path is relative to this file.
const bernardoPageModules: Record<string, any> = import.meta.glob(
  '../../content/stories/bernardo-carpio.*.json',
  { eager: true, import: 'default' }
);
function loadPages(lang: Lang): Promise<Page[]> {
  try {
    // Find key ending with .<lang>.json
    const key = Object.keys(bernardoPageModules).find(k => k.endsWith(`.${lang}.json`));
    const rawArr = (key ? bernardoPageModules[key] : []) as any[];
    const pages = (rawArr || []).map(r => normalizeRawPage(r));
    if(!pages.length){
      console.warn('[bernardo-carpio] JSON glob matched zero pages for lang', lang, 'keys:', Object.keys(bernardoPageModules));
    }
    return Promise.resolve(pages);
  } catch (e) {
    console.warn('[bernardo-carpio] Failed to load JSON pages – using fallback.', e);
    return Promise.resolve([]);
  }
}

function normalizeRawPage(raw: any): Page {
  // Accept legacy shape with question/options at root
  if (raw.quiz) return raw as Page;
  if (raw.question && raw.options) {
    return {
      id: raw.id,
      title: raw.title,
      narration: raw.narration || '',
      character: raw.character,
      illustration: raw.illustration,
      videoMp4: raw.videoMp4, videoWebm: raw.videoWebm, videoPoster: raw.videoPoster,
      quiz: {
        questionSlug: raw.id + '-q',
        question: raw.question,
        options: raw.options.map((o: any) => ({ slug: o.id || o.slug, text: o.text, correct: !!o.correct }))
      }
    };
  }
  return { id: raw.id, title: raw.title, narration: raw.narration || '', character: raw.character, illustration: raw.illustration };
}

/* ===== minimal neutral fallback (only used if JSON fails) ===== */
const minimalFallback: Page[] = [
  { id:'intro', title:'Bernardo Carpio', narration:'(Fallback) Story pages failed to load. Please refresh your connection to view the full legend.' }
];

/* ===== component ===== */
export default function BernardoCarpioStory(){
  const { lang, setLang } = useLang();
  const { toast } = useToast();
  const completionHandledRef = useRef(false);

  // spread navigation (two pages at a time)
  const [spreadStart, setSpreadStart] = useState(0); // left page index
  const [rightUnlocked, setRightUnlocked] = useState(false); // gating left -> right
  const [pendingSide, setPendingSide] = useState<null | 'left' | 'right'>(null); // which side triggered quiz dialog
  const [quizPageIndex, setQuizPageIndex] = useState<number | null>(null);
  const [flipRightNow, setFlipRightNow] = useState(false); // add 'flipped' class to animate

  // pages
  const [loadedPages, setLoadedPages] = useState<Page[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  useEffect(()=>{ let cancelled=false; setPagesLoading(true); loadPages(lang).then(p=>{ if(!cancelled){ setLoadedPages(p); setPagesLoading(false);} }).catch(()=>{ if(!cancelled) setPagesLoading(false); }); return ()=>{ cancelled=true; }; },[lang]);
  const storyPages = loadedPages.length ? loadedPages : minimalFallback; // simplified fallback (no legacy coconut content)

  // debug: log once when pages resolve
  useEffect(()=>{
    if(!pagesLoading){
      console.log('[bernardo-carpio] pages ready', { count: storyPages.length, lang, source: loadedPages.length ? 'json' : 'fallback' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[pagesLoading, loadedPages.length, lang]);

  // loader + entrance animation
  const [isBooting,setIsBooting] = useState(true);
  const [entered,setEntered] = useState(false);
  const [playOpen,setPlayOpen] = useState(false);
  useEffect(()=>{ if(!isBooting) return; const fail=setTimeout(()=>setIsBooting(false),5000); return ()=>clearTimeout(fail); },[isBooting]);
  useEffect(()=>{ if(isBooting && !pagesLoading){ const t=setTimeout(()=>{ setIsBooting(false); requestAnimationFrame(()=> setEntered(true)); setPlayOpen(true); setTimeout(()=> setPlayOpen(false),900); },250); return ()=>clearTimeout(t); } },[isBooting,pagesLoading]);

  // quiz ui state
  const [selectedAnswer,setSelectedAnswer] = useState('');
  const [hasAnswered,setHasAnswered] = useState(false);
  const [isCorrect,setIsCorrect] = useState(false);
  const [feedback,setFeedback] = useState('');
  const [answers,setAnswers] = useState<Record<string,string>>({});

  // environment state
  const [isMuted,setIsMuted] = useState(false);
  const [isFlipping,setIsFlipping] = useState(false);
  const [isFullscreen,setIsFullscreen] = useState(false);
  const [isStoryComplete,setIsStoryComplete] = useState(false);

  // typing cache
  const typedCacheRef = useRef<Set<string>>(new Set());

  const leftIndex = spreadStart;
  const rightIndex = spreadStart + 1;
  const leftPage = storyPages[leftIndex];
  const rightPage = storyPages[rightIndex];

  // keyboard
  useEffect(()=>{ const onKey=(e:KeyboardEvent)=>{ if(pendingSide||isFlipping) return; if(e.key==='ArrowRight'){ e.preventDefault(); handleNext(); } if(e.key==='ArrowLeft'){ e.preventDefault(); handlePrev(); } }; window.addEventListener('keydown',onKey); return ()=> window.removeEventListener('keydown',onKey); },[pendingSide,isFlipping,spreadStart,rightUnlocked]);

  // fullscreen events (graceful fallback)
  useEffect(()=>{ const onFs=()=>{ const on=!!document.fullscreenElement; setIsFullscreen(on); document.body.classList.toggle('book-fullscreen-mode',on); }; document.addEventListener('fullscreenchange',onFs); return ()=> document.removeEventListener('fullscreenchange',onFs); },[]);
  const toggleFullscreen = async () => { try { if(!document.fullscreenElement){ await document.documentElement.requestFullscreen?.({ navigationUI:'hide'} as any); } else { await document.exitFullscreen(); } } catch { const v=!isFullscreen; setIsFullscreen(v); document.body.classList.toggle('book-fullscreen-mode',v); } };

  /* ===== typing text helper ===== */
  const TypingText = memo(function TypingTextMemo({ text, className, speed=45, startDelay=120, cacheKey }: { text:string; className?:string; speed?:number; startDelay?:number; cacheKey:string; }){ const already=typedCacheRef.current.has(cacheKey); const [out,setOut]=useState(already?text:''); const [done,setDone]=useState(already); useEffect(()=>{ if(already) return; setOut(''); setDone(false); const st=setTimeout(()=>{ let i=0; const id=setInterval(()=>{ i++; setOut(text.slice(0,i)); if(i>=text.length){ clearInterval(id); setDone(true); typedCacheRef.current.add(cacheKey);} },speed); },startDelay); return ()=>{ clearTimeout(st); }; },[text,speed,startDelay,cacheKey,already]); return <span className={`nc-typing ${className||''}`}>{out}{!done && <span className="nc-caret" aria-hidden>|</span>}</span>; });

  /* ===== page block ===== */
  const PageBlock = ({ page }: { page: Page }) => {
    if(!page) return null;
    const renderTyped = (fieldKey:string, text?:string) => { if(!text) return null; const key = `${page.id}-${fieldKey}`; if(typedCacheRef.current.has(key)) return <span>{text}</span>; return <TypingText text={text} cacheKey={key} />; };
    return (
      <figure className='nc-figure'>
        <div className='nc-imageFrame'>
          {page.videoMp4 ? (
            <LoopingVideo srcMp4={page.videoMp4} srcWebm={page.videoWebm} poster={page.videoPoster} muted autoPlay playsInline className='nc-video' />
          ) : page.illustration ? (
            <img src={page.illustration} alt='' className='nc-illustration' loading='lazy' />
          ) : <div className='nc-illustration' aria-hidden /> }
          <div className='nc-corner nc-corner--tl'><Mountain size={14}/></div>
          <div className='nc-corner nc-corner--tr'><Sparkles size={14}/></div>
          <div className='nc-corner nc-corner--bl'><Sparkles size={14}/></div>
          <div className='nc-corner nc-corner--br'><Mountain size={14}/></div>
        </div>
        <figcaption className='nc-caption'>
          {page.narration && <p className='nc-narration'>{renderTyped('narration', page.narration)}</p>}
          {!!page.character && <p className='nc-dialog'>{renderTyped('character', page.character)}</p>}
        </figcaption>
      </figure>
    );
  };

  /* ===== checkpoint handling ===== */
  const saveTimer = useRef<number | null>(null);
  const saveCheckpoint = async (forceComplete=false) => {
    try {
      const currentPageNumber = rightUnlocked && rightPage ? (rightIndex + 1) : (leftIndex + 1);
      const percent = forceComplete ? 100 : Math.floor((currentPageNumber / storyPages.length) * 100);
      if(!forceComplete){ if(saveTimer.current) window.clearTimeout(saveTimer.current); await new Promise<void>(r => { saveTimer.current = window.setTimeout(()=>r(),180); }); }
      await saveCheckpointAPI(BOOK_SLUG, { pageNumber: currentPageNumber, answersJson: answers, quizStateJson:{ pendingSide, quizPageIndex, selectedAnswer, hasAnswered, rightUnlocked }, audioPositionSec:0, percentComplete: percent });
    } catch(e){ console.warn('[checkpoint] save failed', e); }
  };
  // load
  useEffect(()=>{ let cancelled=false; (async()=>{ try{ const data= await getCheckpointAPI(BOOK_SLUG); const cp=data?.checkpoint; if(!cp||cancelled) return; const pageNumber=Math.max(1,Math.min(storyPages.length, cp.pageNumber ?? 1)); const spread=Math.floor((pageNumber-1)/2)*2; const unlockRight= pageNumber % 2 === 0; setSpreadStart(spread); setRightUnlocked(unlockRight); if(cp.answersJson && typeof cp.answersJson==='object') setAnswers(cp.answersJson as Record<string,string>); }catch{} })(); return ()=>{ cancelled=true; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{ saveCheckpoint().catch(()=>{}); // initial gentle save
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  /* ===== navigation / gating ===== */
  const handleNext = () => {
    if(pendingSide || isFlipping) return;
    if(rightIndex >= storyPages.length){
      setIsStoryComplete(true);
      if(!completionHandledRef.current){
        completionHandledRef.current = true;
        (async()=>{
          try {
            const resp = await markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG);
            if(resp?.awardedBadge?.badgeName){
              toast({ title: 'Badge Earned!', description: resp.awardedBadge.badgeName });
            }
          } catch {}
          queryClient.invalidateQueries({ queryKey: ['earned-badges'] });
        })();
      }
      saveCheckpoint(true).catch(()=>{});
      return; }
    const goingSide: 'left' | 'right' = rightUnlocked ? 'right' : 'left';
    const targetIndex = goingSide === 'left' ? leftIndex : rightIndex;
    const targetHasQuiz = !!storyPages[targetIndex]?.quiz;
    if(targetHasQuiz){ setPendingSide(goingSide); setQuizPageIndex(targetIndex); return; }
    if(goingSide==='left') { setRightUnlocked(true); saveCheckpoint().catch(()=>{}); }
    else { // flip spread
      setIsFlipping(true); setFlipRightNow(true);
      setTimeout(()=>{
        const nextLeft = spreadStart + 2;
  if(nextLeft >= storyPages.length){ setIsStoryComplete(true); if(!completionHandledRef.current){ completionHandledRef.current = true; (async()=>{ try { const resp = await markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG); if(resp?.awardedBadge?.badgeName){ toast({ title: 'Badge Earned!', description: resp.awardedBadge.badgeName }); } } catch {} queryClient.invalidateQueries({ queryKey: ['earned-badges'] }); })(); } saveCheckpoint(true).catch(()=>{}); }
        else { setSpreadStart(nextLeft); setRightUnlocked(false); saveCheckpoint().catch(()=>{}); }
        setIsFlipping(false); setFlipRightNow(false);
      },650);
    }
  };
  const handlePrev = () => { if(pendingSide||isFlipping) return; if(spreadStart>0){ setIsFlipping(true); setTimeout(()=>{ setSpreadStart(p=> Math.max(0,p-2)); setRightUnlocked(true); setIsFlipping(false); saveCheckpoint().catch(()=>{}); },500); } };

  /* ===== quiz helpers ===== */
  const resetQuiz = () => { setSelectedAnswer(''); setHasAnswered(false); setIsCorrect(false); setFeedback(''); };
  const handleAnswerSubmit = () => { if(quizPageIndex==null) return; const q = storyPages[quizPageIndex]?.quiz; if(!q) return; const correct = q.options.find(o=>o.slug===selectedAnswer)?.correct; const ok=!!correct; setIsCorrect(ok); setHasAnswered(true); setFeedback(ok? i18n[lang].fbCorrect : i18n[lang].fbWrong); if(ok){ setAnswers(prev=>({...prev,[q.questionSlug]:selectedAnswer})); } };
  const tryAgain = () => resetQuiz();
  const continueAfterCorrect = () => { if(!isCorrect || pendingSide==null) return; if(pendingSide==='left'){ setRightUnlocked(true); setPendingSide(null); setQuizPageIndex(null); resetQuiz(); saveCheckpoint().catch(()=>{}); } else { setPendingSide(null); setQuizPageIndex(null); resetQuiz(); setFlipRightNow(true); setIsFlipping(true); setTimeout(()=>{ const nextLeft= spreadStart + 2; if(nextLeft >= storyPages.length){ setIsStoryComplete(true); if(!completionHandledRef.current){ completionHandledRef.current = true; (async()=>{ try { const resp = await markBookCompleteAPI(BOOK_ID ?? BOOK_SLUG); if(resp?.awardedBadge?.badgeName){ toast({ title: 'Badge Earned!', description: resp.awardedBadge.badgeName }); } } catch {} queryClient.invalidateQueries({ queryKey: ['earned-badges'] }); })(); } saveCheckpoint(true).catch(()=>{}); } else { setSpreadStart(nextLeft); setRightUnlocked(false); saveCheckpoint().catch(()=>{}); } setIsFlipping(false); setFlipRightNow(false); },650); } };
  const restartStory = () => { setSpreadStart(0); setRightUnlocked(false); setPendingSide(null); setQuizPageIndex(null); setIsStoryComplete(false); setFlipRightNow(false); setAnswers({}); resetQuiz(); resetCheckpointAPI(BOOK_SLUG).catch(()=>{}); saveCheckpoint().catch(()=>{}); };

  /* ===== styles for fullscreen centering ===== */
  const fsWrapStyle: React.CSSProperties | undefined = isFullscreen ? { position:'fixed', inset:0, display:'grid', placeItems:'center', paddingTop:'3svh', zIndex:3 } : undefined;
  const hardReset: React.CSSProperties | undefined = isFullscreen ? { position:'relative', inset:'auto', transform:'none', margin:0 } : undefined;
  const fsBookStyle: React.CSSProperties | undefined = isFullscreen ? { ...hardReset, aspectRatio:'3 / 2', width:'min(1600px,96vw)', height:'auto', maxHeight:'92svh', display:'block', transform:'translateY(2svh)' } : undefined;

  /* ===== render ===== */
  return (
    <div className={`min-h-screen flex flex-col kid-theme bernardo-theme ${isFullscreen? 'book-fullscreen-mode':''} ${isBooting? 'nc-booting':''}`}>
      {/* subtle background (reuse gradient) */}
      <div className='nc-bg bernardo-bg' aria-hidden='true' />

      {/* loader */}
      <div className={`nc-loader ${isBooting? '' : 'hidden'}`} aria-live='polite' aria-busy={isBooting}>
        <div className='nc-load-card'>
          <div className='nc-brand'><div className='nc-beads'/></div>
          <div className='nc-title-xl'>{i18n[lang].title}</div>
          <div className='nc-subtle'>{i18n[lang].sub}</div>
          <div className='nc-progress' role='progressbar' aria-valuetext={i18n[lang].loading}><span/></div>
        </div>
      </div>

      <div className="kid-fore">
        {!isFullscreen && <Header variant='student' />}
        <main className={`flex-grow flex flex-col items-center justify-center ${isFullscreen? 'p-0':'p-4 md:p-6'}`}>
        {!isFullscreen && (
          <div className='w-full max-w-7xl'>
            <div className='flex justify-between items-center mb-6'>
              <Link href='/student/twodanimation'>
                <Button variant='outline' className='kid-btn btn-solid-white flex items-center gap-2'>
                  <ChevronLeft size={16}/> {i18n[lang].backToStories}
                </Button>
              </Link>
              <div className='text-center'>
                <h1 className='kid-heading text-2xl font-bold'>{i18n[lang].title}</h1>
                <div className='text-sm opacity-80'>
                  {rightUnlocked && rightIndex < storyPages.length ?
                    i18n[lang].pageRangeOf(String(Math.min(spreadStart+1, storyPages.length)), String(rightIndex+1), String(storyPages.length)) :
                    i18n[lang].pageOf(String(Math.min(spreadStart+1, storyPages.length)), String(storyPages.length))}
                </div>
              </div>
              <div className='flex gap-2'>
                <Button onClick={()=> setLang(l => l==='en'?'fil':'en')} className='kid-btn btn-solid-white' aria-label={i18n[lang].langToggleAria} title={i18n[lang].langToggleAria}>
                  <Languages size={16} className='mr-2'/>{i18n[lang].langToggle(lang)}
                </Button>
                <Button onClick={toggleFullscreen} className='kid-btn btn-solid-white'>{isFullscreen? <Minimize size={16}/> : <Maximize size={16}/>}</Button>
                <Button onClick={()=> setIsMuted(v=>!v)} className='kid-btn btn-solid-white'>{isMuted? <VolumeX size={16}/> : <Volume2 size={16}/>}</Button>
              </div>
            </div>
          </div>
        )}

        {/* Book */}
        <div className={`popup-open-book-wrapper relative mx-auto ${entered? 'nc-enter nc-enter-active':'nc-enter'}`} style={fsWrapStyle}>
          <div className='popup-book-container' style={hardReset}>
            <div className='popup-flip-book-container' key={isFullscreen? 'fs':'norm'} style={fsBookStyle}>
              <div className={`popup-book-wrapper ${playOpen? 'nc-opening':''}`}>
                <div className='popup-book-fold'/>
                {(!isBooting && pagesLoading) && (
                  <div className='nc-skeleton-spread' aria-hidden>
                    <div className='nc-skeleton-page'/><div className='nc-skeleton-page'/>
                  </div>
                )}
                <div className='popup-page-left'>
                  <div className='story-content p-6'>
                    {!pagesLoading && leftPage && <PageBlock page={leftPage} />}
                    <div className='absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs'>{leftIndex+1}</div>
                  </div>
                </div>
                <div className={`popup-page-right ${flipRightNow? 'flipped':''}`}>
                  <div className='story-content p-6 text-center'>
                    {!pagesLoading && rightUnlocked && rightPage ? (
                      <>
                        <PageBlock page={rightPage}/>
                        <div className='absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs'>{rightIndex+1}</div>
                      </>
                    ) : (
                      <div className='h-full flex items-center justify-center opacity-40 text-sm italic'>
                        <Sparkles className='mr-2' size={16}/> {i18n[lang].unlockHint}
                      </div>
                    )}
                  </div>
                </div>
                <button className='popup-page-nav-left' onClick={handlePrev} disabled={isFlipping || spreadStart===0} aria-label='Previous'>
                  <ChevronLeft size={24}/>
                </button>
                <button className='popup-page-nav-right' onClick={handleNext} disabled={isFlipping || pendingSide!==null || pagesLoading} aria-label='Next'>
                  <ChevronRight size={24}/>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Quiz dialog */}
        <Dialog open={pendingSide!==null} onOpenChange={(open)=>{ if(!open){ setPendingSide(null); setQuizPageIndex(null); resetQuiz(); } }}>
          <DialogContent className='max-w-md' aria-describedby='bernardo-quiz-desc'>
            <DialogHeader>
              <DialogTitle className='kid-heading' id='bernardo-quiz-title'>{i18n[lang].question}</DialogTitle>
              <DialogDescription id='bernardo-quiz-desc'>
                {quizPageIndex!=null && storyPages[quizPageIndex]?.quiz?.question ? storyPages[quizPageIndex]?.quiz?.question : 'Answer to continue.'}
              </DialogDescription>
            </DialogHeader>
            <RadioGroup value={selectedAnswer} onValueChange={setSelectedAnswer} aria-labelledby='bernardo-quiz-title'>
              {quizPageIndex!=null && storyPages[quizPageIndex]?.quiz?.options?.map(opt => (
                <div key={opt.slug} className='flex items-center space-x-2 my-2'>
                  <RadioGroupItem value={opt.slug} id={`opt-${opt.slug}`}/>
                  <Label htmlFor={`opt-${opt.slug}`}>{opt.text}</Label>
                </div>
              ))}
            </RadioGroup>
            {hasAnswered && (
              <div className={`mt-4 p-2 rounded text-sm font-semibold ${isCorrect? 'text-green-600':'text-red-600'}`} role='status' aria-live='polite'>
                {feedback}
              </div>
            )}
            <DialogFooter className='mt-4 gap-2'>
              {hasAnswered ? (
                isCorrect ? (
                  <Button onClick={continueAfterCorrect} className='kid-btn bg-green-600 hover:bg-green-700 text-white'>
                    <Check size={16} className='mr-2'/> {i18n[lang].continue}
                  </Button>
                ) : (
                  <Button onClick={tryAgain} className='kid-btn bg-blue-600 hover:bg-blue-700 text-white'>
                    <RefreshCw size={16} className='mr-2'/> {i18n[lang].tryAgain}
                  </Button>
                )
              ) : (
                <Button onClick={handleAnswerSubmit} disabled={!selectedAnswer} className='kid-btn bg-blue-700 hover:bg-blue-600 text-white'>
                  {i18n[lang].submit}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Finale */}
        <Dialog open={isStoryComplete} onOpenChange={setIsStoryComplete}>
          <DialogContent className='max-w-md nc-finale-box nc-finale-lift !max-h-none !h-auto !overflow-visible'>
            <DialogHeader>
              <div className='nc-finale-badge' aria-hidden><span className='nc-finale-moon'/><span className='nc-finale-beads'/></div>
              <DialogTitle className='kid-heading'>{i18n[lang].finaleTitle}</DialogTitle>
              <DialogDescription>{i18n[lang].finaleDesc}</DialogDescription>
            </DialogHeader>
            <div className='flex flex-wrap gap-2 mt-5 justify-between'>
              <Button onClick={restartStory} className='kid-btn nc-finale-btn-primary'>
                <RefreshCw size={16} className='mr-2'/> {i18n[lang].readAgain}
              </Button>
              <Link href='/student/twodanimation'>
                <Button className='kid-btn nc-finale-btn-outline' onClick={()=>{ restartStory(); resetCheckpointAPI(BOOK_SLUG).catch(()=>{}); }}>
                  <Home size={16} className='mr-2'/> {i18n[lang].backToShelf}
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