import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// Generation uses Sonnet (good quality for structured writing). Grading
// free-text answers uses Haiku — cheaper and fast enough, since it's just
// scoring against a rubric rather than composing anything.
export const GENERATION_MODEL = 'claude-sonnet-5';
export const GRADING_MODEL = 'claude-haiku-4-5-20251001';

export function isConfigured() {
  return Boolean(anthropic);
}

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Best-effort text extraction from an uploaded file — PDF and modern Word
// (.docx) are supported. Legacy .doc (the old binary Word format,
// pre-2007) and images are silently skipped. This is a real limitation,
// not hidden: callers surface it in their response so the person knows.
// Used for both subject syllabi and student assignment submissions.
export async function extractTextFromFile(uploadDir, filename, mimeType) {
  if (!filename) return null;
  const filePath = path.join(uploadDir, filename);

  try {
    if (mimeType === 'application/pdf') {
      const { default: pdfParse } = await import('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text?.slice(0, 15000) || null; // cap input size sent to the API
    }
    if (mimeType === DOCX_MIME_TYPE) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value?.slice(0, 15000) || null;
    }
    return null; // unsupported type (legacy .doc, images, etc.)
  } catch (err) {
    console.error('[ai] file text extraction failed', err);
    return null;
  }
}

export function extractJson(text) {
  // The model is asked to return only JSON, but strip any accidental
  // markdown code fences just in case.
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}

// Grades free-text work (a quiz's short-answer/scenario question, or an
// entire assignment submission) on a 0-100 scale against a rubric.
export async function gradeFreeText({ prompt, rubric, answer }) {
  if (!anthropic || !answer?.trim()) return { score: 0, feedback: 'No answer provided.' };
  const gradingPrompt = `Grade this student's work on a 0-100 scale based on the rubric. Be reasonably lenient — partial credit for partially correct or partially complete work.

Prompt/question: ${prompt}
Rubric (key points expected): ${rubric || 'Use general subject knowledge to judge correctness and effort.'}
Student's answer/submission: ${answer}

Return ONLY valid JSON: {"score": <0-100 integer>, "feedback": "<one or two short sentences of feedback>"}`;

  try {
    const response = await anthropic.messages.create({
      model: GRADING_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: gradingPrompt }],
    });
    const text = response.content.find((b) => b.type === 'text')?.text || '';
    const parsed = extractJson(text);
    return { score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), feedback: parsed.feedback || '' };
  } catch (err) {
    console.error('[ai] grading failed, falling back to ungraded', err);
    return { score: 0, feedback: 'Automatic grading failed — a teacher may need to review this.' };
  }
}
