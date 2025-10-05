// == IMPORTS & DEPENDENCIES ==
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trash2, Plus, Upload, X, Image, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription
} from '@/components/ui/form';
import { motion, AnimatePresence } from '@/lib/motionShim';

/** ================= Cloudinary helpers (Vite + Next-safe) ================= */
const cloud =
  ((typeof import.meta !== 'undefined' ? (import.meta as any)?.env : undefined)
    ?.VITE_CLOUDINARY_CLOUD_NAME as string | undefined) ||
  ((typeof globalThis !== 'undefined'
    ? (globalThis as any).NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
    : undefined) as string | undefined) ||
  ((typeof process !== 'undefined' ? (process as any).env : undefined)
    ?.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME as string | undefined) ||
  ((typeof process !== 'undefined' ? (process as any).env : undefined)
    ?.VITE_CLOUDINARY_CLOUD_NAME as string | undefined) ||
  '';

const clUrl = (publicId?: string, w = 800, h = 450) => {
  if (!publicId || !cloud) return '';
  return `https://res.cloudinary.com/${cloud}/image/upload/c_fill,w=${w},h=${h},q_auto,f_auto/${publicId}`;
};

// == TYPE DEFINITIONS ==
export interface Question {
  questionText: string;
  answerType: string;
  correctAnswer?: string;
  options?: string;
}

const pageSchema = z.object({
  pageNumber: z.coerce.number().min(1, 'Page number is required'),
  title: z.string().default(''),
  content: z.string().min(1, 'Content is required'),
  imageUrl: z.string().default(''),
  imagePublicId: z.string().default(''),
});

export interface PageFormValues extends z.infer<typeof pageSchema> {
  id?: number;
  questions?: Question[];
  showNotification?: boolean;
}

interface PageFormProps {
  initialValues?: PageFormValues;
  pageNumber: number;
  onSave: (values: PageFormValues) => void;
  onRemove: () => void;
  showRemoveButton?: boolean;
}

// == Motion presets (UI-only) ==
const fadeCard = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};
const sectionFade = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};
const itemFade = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: 'easeIn' } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

// == helpers ==
const getToken = () => {
  if (typeof window === 'undefined') return null;
  const t = localStorage.getItem('token');
  return t && t !== 'null' ? t : null;
};

async function uploadPageImage(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'page_image');

  const token = getToken();
  const resp = await fetch(`/api/upload?folder=${encodeURIComponent('ilaw-ng-bayan/pages/images')}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
  const data = await resp.json();
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || 'Image upload failed');
  }
  // { success, url, publicId, ... }
  return data as { success: true; url: string; publicId: string };
}

// == PAGE FORM COMPONENT ==
export function PageForm({
  initialValues,
  pageNumber,
  onSave,
  onRemove,
  showRemoveButton = true
}: PageFormProps) {

  // == State & Refs ==
  const { toast } = useToast();
  const [hasQuestions, setHasQuestions] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(initialValues?.questions || []);
  const [imagePreview, setImagePreview] = useState<string | null>(initialValues?.imageUrl || null);
  const [imageUploading, setImageUploading] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(initialValues?.imageUrl || null);
  const [previewTriedTransformed, setPreviewTriedTransformed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [lastQuestionsChange, setLastQuestionsChange] = useState(0);
  const [lastImageChange, setLastImageChange] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const latestPayloadRef = useRef<PageFormValues | null>(null);
  const lastEditRef = useRef<number>(Date.now());
  const INACTIVITY_MS = 5000; // user considered "done" after 5s idle

  // == Effects ==
  useEffect(() => {
    if (initialValues?.questions && initialValues.questions.length > 0) {
      setQuestions(initialValues.questions);
      setHasQuestions(true);
    }
    setTimeout(() => setIsInitialLoad(false), 1000);
  }, [initialValues?.questions]);

  // == Form Initialization ==
  const form = useForm<PageFormValues>({
    resolver: zodResolver(pageSchema),
    defaultValues: {
      pageNumber: initialValues?.pageNumber || pageNumber,
      title: initialValues?.title || '',
      content: initialValues?.content || '',
      imageUrl: initialValues?.imageUrl || '',
      imagePublicId: initialValues?.imagePublicId || '',
    },
  });

  // Prefer Cloudinary preview if a publicId is present; fall back to local upload preview; finally raw URL field
  const cloudPublicId = form.watch('imagePublicId');
  const watchedImageUrl = form.watch('imageUrl');
  const transformed = cloudPublicId ? clUrl(cloudPublicId) : '';
  const fallbackRaw = imagePreview || (watchedImageUrl && /^https?:\/\//i.test(watchedImageUrl) ? watchedImageUrl : '');

  // Decide which to show: try transformed once; if it errors, stick to fallbackRaw
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (transformed && !previewTriedTransformed) {
      setPreviewTriedTransformed(true);
      const testImg: HTMLImageElement = document.createElement('img');
      testImg.onload = () => setPreviewSrc(transformed);
      testImg.onerror = () => setPreviewSrc(fallbackRaw || null);
      testImg.src = transformed;
    } else if (!transformed) {
      setPreviewSrc(fallbackRaw || null);
    } else if (!previewSrc) {
      setPreviewSrc(fallbackRaw || null);
    }
  }, [transformed, fallbackRaw]);

  // Unified debounced auto-save (reduces flicker / re-render storms)
  const buildPayload = useCallback((showNotification: boolean): PageFormValues | null => {
    const v = form.getValues();
    if (!v.content || !v.content.trim()) return null;
    return {
      id: initialValues?.id,
      pageNumber,
      title: v.title ?? '',
      content: v.content ?? '',
      imageUrl: v.imageUrl ?? '',
      imagePublicId: v.imagePublicId ?? '',
      questions: questions.length > 0 ? questions : undefined,
      showNotification
    };
  }, [form, initialValues?.id, pageNumber, questions]);

  const flushSave = useCallback(() => {
    if (isInitialLoad) return;
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const payload = latestPayloadRef.current || buildPayload(true);
    if (payload) {
      onSave(payload);
      setHasUnsavedChanges(false);
    }
  }, [buildPayload, isInitialLoad, onSave]);

  const queueSave = useCallback((showNotification: boolean) => {
    if (isInitialLoad) return;
    const payload = buildPayload(showNotification);
    if (!payload) return;
    latestPayloadRef.current = payload;
    lastEditRef.current = Date.now();
    setHasUnsavedChanges(true);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      // Only save if we have been idle for INACTIVITY_MS
      const idleFor = Date.now() - lastEditRef.current;
      if (idleFor >= INACTIVITY_MS) {
        flushSave();
      } else {
        // reschedule remaining time
        const remaining = INACTIVITY_MS - idleFor + 50;
        saveTimerRef.current = window.setTimeout(() => flushSave(), remaining);
      }
    }, INACTIVITY_MS);
  }, [buildPayload, flushSave, isInitialLoad, INACTIVITY_MS]);

  // Watch content/title/image fields changes (idle-based autosave)
  useEffect(() => {
    const sub = form.watch((_vals, info) => {
      if (info?.type === 'change') queueSave(false);
    });
    return () => sub.unsubscribe();
  }, [form, queueSave]);

  // Re-queue when questions change (more immediate)
  useEffect(() => {
    if (isInitialLoad) return;
    if (questions) queueSave(true);
  }, [questions, isInitialLoad, queueSave]);

  // Re-queue when image changed explicitly
  useEffect(() => {
    if (isInitialLoad) return;
    if (lastImageChange) queueSave(true);
  }, [lastImageChange, isInitialLoad, queueSave]);

  // == Image Handling (via /api/upload) ==
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Error",
        description: "Image size should be less than 5MB",
        variant: "destructive"
      });
      return;
    }

    try {
      setImageUploading(true);
  const { url, publicId } = await uploadPageImage(file);

      // set both URL and publicId
      form.setValue('imageUrl', url, { shouldDirty: true });
      form.setValue('imagePublicId', publicId ?? '', { shouldDirty: true });
      setImagePreview(url);
  setPreviewSrc(url); // show raw uploaded image immediately
  setPreviewTriedTransformed(false); // allow transformed retry for new upload
      setHasUnsavedChanges(true);
      setLastImageChange(Date.now());

  queueSave(true);

      toast({ title: 'Image uploaded', description: 'Page image uploaded successfully.' });
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err?.message || 'Could not upload image.',
        variant: 'destructive'
      });
    } finally {
      setImageUploading(false);
    }
  };

  const clearImage = () => {
  setImagePreview(null);
  setPreviewSrc(null);
    form.setValue("imageUrl", "");
    form.setValue("imagePublicId", "");
    setHasUnsavedChanges(true);
    setLastImageChange(Date.now());

  queueSave(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // == Question Utilities ==
  const getOptionsList = (optionsString?: string): string[] => {
    if (!optionsString) return [];
    return optionsString.includes('\n')
      ? optionsString.split('\n').filter(opt => opt.trim() !== '')
      : optionsString.split(',').map(opt => opt.trim()).filter(opt => opt !== '');
  };

  // == Question Management ==
  const addQuestion = () => {
    setQuestions([
      ...questions,
      { questionText: '', answerType: 'text', correctAnswer: '', options: '' }
    ]);
    setHasQuestions(true);
    setHasUnsavedChanges(true);
    setLastQuestionsChange(Date.now());
  };

  const removeQuestion = (index: number) => {
    const updated = [...questions];
    updated.splice(index, 1);
    setQuestions(updated);
    setHasUnsavedChanges(true);
    setLastQuestionsChange(Date.now());
    if (updated.length === 0) setHasQuestions(false);
  };

  const updateQuestion = (index: number, field: keyof Question, value: string) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], [field]: value };

    if (field === 'answerType' && value === 'multiple_choice') {
      const current = updated[index];
      const opts = getOptionsList(current.options);
      if (opts.length === 0) current.options = "Option 1\nOption 2\nOption 3";
    }

    setQuestions(updated);
    setHasUnsavedChanges(true);
    setLastQuestionsChange(Date.now());
  };

  // == Option Management ==
  const addOption = (qi: number) => {
    const q = questions[qi];
    const opts = getOptionsList(q.options || '');
    const optionsString = [...opts, `Option ${opts.length + 1}`].join('\n');
    updateQuestion(qi, 'options', optionsString);
  };

  const removeOption = (qi: number, oi: number) => {
    const q = questions[qi];
    const opts = getOptionsList(q.options);
    if (q.correctAnswer === opts[oi]) updateQuestion(qi, 'correctAnswer', '');
    const next = opts.slice(0, oi).concat(opts.slice(oi + 1)).join('\n');
    updateQuestion(qi, 'options', next);
  };

  const updateOptionText = (qi: number, oi: number, text: string) => {
    const q = questions[qi];
    const opts = getOptionsList(q.options);
    if (q.correctAnswer === opts[oi]) updateQuestion(qi, 'correctAnswer', text);
    opts[oi] = text;
    updateQuestion(qi, 'options', opts.join('\n'));
  };

  // == Render Component ==
  return (
    <motion.div
      variants={fadeCard}
      initial="hidden"
      animate="visible"
      className="border-2 border-brand-gold-200 bg-white rounded-2xl shadow-lg mb-5"
    >
      {/* == Page Header == */}
      <div className="border-b border-brand-gold-200 p-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-heading font-bold text-ilaw-navy flex items-center">
            <Sparkles className="h-5 w-5 text-ilaw-gold mr-2" />
            📄 Page {pageNumber}
            {hasUnsavedChanges && !isInitialLoad && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="ml-2 text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium"
              >
                • Unsaved
              </motion.span>
            )}
          </h3>
          {showRemoveButton && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onRemove}
              className="bg-red-500 hover:bg-red-600 text-white font-heading font-bold"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Remove Page
            </Button>
          )}
        </div>
      </div>

      {/* == Form Content == */}
      <div className="p-4">
        <Form {...form}>
          <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-5">

            {/* Hidden field for Cloudinary ID */}
            <FormField control={form.control} name="imagePublicId" render={({ field }) => (<input type="hidden" {...field} />)} />

            {/* === Top Grid: fields (2 cols) + image (1 col) === */}
            <motion.div variants={sectionFade} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
              {/* Left: fields */}
              <div className="md:col-span-2 flex flex-col gap-4 md:h-full">
                {/* Title */}
                <motion.div variants={itemFade}>
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem className="!space-y-1">
                        <FormLabel className="text-ilaw-navy font-heading font-bold">Page Title (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter a title for this page"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value)}
                            className="border-2 border-brand-gold-200 focus:border-ilaw-gold"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Content */}
                <motion.div variants={itemFade}>
                  <FormField
                    control={form.control}
                    name="content"
                    render={({ field }) => (
                      <FormItem className="!space-y-1 flex-1 flex flex-col">
                        <FormLabel className="text-ilaw-navy font-heading font-bold">Page Content</FormLabel>
                        <FormControl className="flex-1 flex">
                          <Textarea
                            placeholder="Enter the content for this page..."
                            {...field}
                            className="border-2 border-brand-gold-200 focus:border-ilaw-gold flex-1 h-full min-h-[260px] md:min-h-0 resize-vertical md:resize-none"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>
              </div>

              {/* Right: image panel */}
              <motion.div variants={itemFade} className="md:col-span-1 space-y-3">
                <FormField
                  control={form.control}
                  name="imageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-ilaw-navy font-heading font-bold">🖼️ Page Image</FormLabel>
                      <div className="space-y-3">
                        {/* Preview */}
                        <AnimatePresence initial={false} mode="popLayout">
                          {previewSrc ? (
                            <motion.div
                              key="img-preview"
                              initial={{ opacity: 0, scale: 0.98 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.98 }}
                              className="relative w-full"
                            >
                              <div className="relative aspect-[3/4] bg-brand-gold-50 rounded-xl overflow-hidden border-2 border-brand-gold-200">
                                <img
                                  src={previewSrc}
                                  alt="Page image preview"
                                  className="w-full h-full object-cover"
                                  onError={() => {
                                    // fallback to raw if transformed failed
                                    if (previewSrc === transformed && fallbackRaw) {
                                      setPreviewSrc(fallbackRaw);
                                    }
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="icon"
                                  className="absolute top-2 right-2 h-8 w-8 rounded-full bg-red-500 hover:bg-red-600"
                                  onClick={clearImage}
                                  disabled={imageUploading}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="img-drop"
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -6 }}
                              className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-brand-gold-300 rounded-xl bg-brand-gold-50"
                            >
                              <Image className="h-7 w-7 text-brand-gold-600 mb-2" />
                              <p className="text-sm text-brand-gold-600 font-medium mb-2">
                                Upload an image for this page
                              </p>
                              <div className="flex items-center space-x-2">
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                                  className="hidden"
                                  onChange={handleImageUpload}
                                  id={`image-upload-${pageNumber}`}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="border-2 border-brand-gold-300 text-ilaw-navy hover:bg-brand-gold-100 font-heading font-bold"
                                  onClick={() => fileInputRef.current?.click()}
                                  disabled={imageUploading}
                                >
                                  {imageUploading ? (
                                    <>
                                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                      Uploading…
                                    </>
                                  ) : (
                                    <>
                                      <Upload className="h-4 w-4 mr-1" />
                                      Choose Image
                                    </>
                                  )}
                                </Button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* URL input */}
                        <div className="relative">
                          <FormControl>
                            <Input
                              placeholder="Or enter image URL"
                              {...field}
                              value={field.value || ''}
                              className="border-2 border-brand-gold-200 focus:border-ilaw-gold"
                              onChange={(e) => {
                                const v = e.target.value;
                                field.onChange(v);
                                // if user pastes a URL, clear publicId so preview uses URL
                                if (v) form.setValue('imagePublicId', '');
                                setImagePreview(v || null);
                                setLastImageChange(Date.now());
                                setHasUnsavedChanges(true);
                              }}
                              disabled={imageUploading}
                            />
                          </FormControl>
                          <FormDescription className="text-brand-gold-600 font-medium">
                            You can upload OR paste a direct URL. Uploading uses Cloudinary.
                          </FormDescription>
                          <FormMessage />
                        </div>
                      </div>
                    </FormItem>
                  )}
                />
              </motion.div>
            </motion.div>

            {/* == Questions Section == */}
            <motion.div variants={sectionFade} className="pt-5 border-t-2 border-brand-gold-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-heading font-bold text-ilaw-navy flex items-center">
                  ❓ Questions
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addQuestion}
                  className="border-2 border-brand-gold-300 text-ilaw-navy hover:bg-brand-gold-100 font-heading font-bold transition-transform hover:-translate-y-0.5"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Question
                </Button>
              </div>

              <AnimatePresence initial={false}>
                {questions.map((question, index) => (
                  <motion.div
                    key={index}
                    variants={itemFade}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="p-4 border-2 border-brand-gold-200 rounded-xl mb-3 bg-brand-gold-50"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="text-base font-heading font-bold text-ilaw-navy">❓ Question {index + 1}</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQuestion(index)}
                        className="h-8 text-red-500 hover:text-red-700 hover:bg-red-50 font-bold"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <Label className="text-ilaw-navy font-heading font-bold">Question Text</Label>
                        <Textarea
                          value={question.questionText}
                          onChange={(e) => updateQuestion(index, 'questionText', e.target.value)}
                          placeholder="Enter your question here..."
                          className="mt-1 border-2 border-brand-gold-200 focus:border-ilaw-gold"
                          rows={3}
                        />
                      </div>

                      <div>
                        <Label className="text-ilaw-navy font-heading font-bold">Answer Type</Label>
                        <select
                          value={question.answerType}
                          onChange={(e) => updateQuestion(index, 'answerType', e.target.value)}
                          className="w-full mt-1 p-2 border-2 border-brand-gold-200 rounded-lg focus:border-ilaw-gold font-medium"
                        >
                          <option value="text">✍️ Text</option>
                          <option value="multiple_choice">🔘 Multiple Choice</option>
                        </select>
                      </div>

                      <AnimatePresence initial={false} mode="popLayout">
                        {question.answerType === 'text' && (
                          <motion.div
                            key={`text-${index}`}
                            variants={itemFade}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                          >
                            <Label className="text-ilaw-navy font-heading font-bold">Correct Answer</Label>
                            <Input
                              value={question.correctAnswer || ''}
                              onChange={(e) => updateQuestion(index, 'correctAnswer', e.target.value)}
                              placeholder="Enter the correct answer"
                              className="mt-1 border-2 border-brand-gold-200 focus:border-ilaw-gold"
                            />
                          </motion.div>
                        )}

                        {question.answerType === 'multiple_choice' && (
                          <motion.div
                            key={`mc-${index}`}
                            variants={itemFade}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                          >
                            <Label className="text-ilaw-navy font-heading font-bold">Options</Label>
                            <div className="border-2 border-brand-gold-200 rounded-xl mt-1 bg-white">
                              {getOptionsList(question.options).map((option, optionIdx) => (
                                <div key={optionIdx} className="flex items-center p-3 border-b border-brand-gold-200 last:border-b-0">
                                  <input
                                    type="radio"
                                    id={`question-${index}-option-${optionIdx}`}
                                    name={`question-${index}-correct`}
                                    className="mr-3 h-4 w-4 text-ilaw-gold"
                                    checked={question.correctAnswer === option}
                                    onChange={() => updateQuestion(index, 'correctAnswer', option)}
                                  />
                                  <input
                                    type="text"
                                    value={option}
                                    onChange={(e) => updateOptionText(index, optionIdx, e.target.value)}
                                    className="flex-1 border-0 focus:ring-0 p-1 font-medium text-ilaw-navy"
                                    placeholder={`Option ${optionIdx + 1}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => removeOption(index, optionIdx)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}

                              <div className="p-3">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => addOption(index)}
                                  className="w-full justify-center border-2 border-dashed border-brand-gold-300 text-brand-gold-600 hover:bg-brand-gold-100 font-bold"
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add Option
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-brand-gold-600 mt-1 font-medium">
                              Select the radio button next to the correct answer
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {questions.length === 0 && (
                <motion.p
                  variants={itemFade}
                  initial="hidden"
                  animate="visible"
                  className="text-sm text-brand-gold-600 italic font-medium text-center p-4 bg-brand-gold-50 rounded-xl border-2 border-brand-gold-200"
                >
                  No questions added yet. Click 'Add Question' to add interactive questions to this page.
                </motion.p>
              )}
            </motion.div>

            {/* == Auto-Save Status == */}
            <motion.div variants={sectionFade} className="pt-5 border-t-2 border-brand-gold-200">
              <div className="bg-gradient-to-r from-brand-gold-50 to-brand-navy-50/40 border-2 border-brand-gold-200 rounded-xl p-3 text-center">
                <p className="text-sm text-ilaw-navy font-medium flex items-center justify-center">
                  <Sparkles className="h-4 w-4 mr-2 text-ilaw-gold" />
                  ✨ Changes save automatically. Click "Save Changes" at the bottom to update the book.
                </p>
              </div>
            </motion.div>
          </motion.div>
        </Form>
      </div>
    </motion.div>
  );
}