import "server-only";

import { fullText } from "@/lib/job-search/find";
import type { FoundPosting } from "@/lib/job-search/search";
import { storePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";

import { connectorSince } from "./oauth";

// Handing work to Claude chat (#221): with the Claude connector on and no AI
// model of Dossier's own, the buttons that need one open a new claude.ai chat
// instead, with a short prompt that names the posting by an id the connector
// can read. The chat runs on the user's own Claude plan, in Anthropic's own
// app; Dossier never sees or keeps anything of the Claude account.

/** A pasted posting waits this long for Claude to read it. */
export const PASTE_DAYS = 14;

/** What a paste's id looks like, which the connector's tools and the launcher link only accept. */
const PASTE_ID = /^[0-9a-f-]{36}$/i;

export type Handoff = "write" | "score";

/** A new claude.ai chat that starts with `prompt`. Prompts stay short: links over about 2,000 characters break. */
export const claudeChatUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

/** Whether the buttons hand work to Claude: the connector is on and Dossier has no usable model of its own. */
export async function handsOffToClaude(aiUsable: boolean): Promise<boolean> {
  return !aiUsable && (await connectorSince()) !== null;
}

const describe = (title: string, company: string) =>
  [title, company]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" at ");

function promptFor(kind: Handoff, ref: string, about: string): string {
  const what = about ? `the job posting ${ref} (${about})` : `the job posting ${ref}`;
  if (kind === "score") {
    return (
      `Using my Dossier connector: score how well ${what} fits my profile. ` +
      "Read it with get_posting and my profile with get_profile, give a score from 0 to 100 with the reasons and any red flags, and save it with save_job_scores."
    );
  }
  return (
    `Using my Dossier connector: write a tailored resume and cover letter for ${what}. ` +
    "Read it with get_posting and my profile with get_profile. Use only facts from my profile and tell me about any gaps. " +
    "Show me a short summary and the fit, then save it with save_application."
  );
}

/** For a posting from Find jobs: keeps it with its whole text, and gives the chat to open. */
export async function handOffFoundPosting(posting: FoundPosting, kind: Handoff): Promise<string> {
  const text = posting.complete ? posting.description : await fullText(posting);
  const stored = await storePosting(text ? { ...posting, description: text, complete: true } : posting);
  return claudeChatUrl(promptFor(kind, `with posting_id "${stored.id}"`, describe(posting.title, posting.company)));
}

/** Keeps a pasted posting's text for Claude to read; its id. */
async function keepPastedPosting({ text, url }: { text: string; url: string }, now: Date): Promise<string> {
  const paste = await prisma.claudePaste.create({
    data: { text, url, expiresAt: new Date(now.getTime() + PASTE_DAYS * 24 * 60 * 60 * 1000) },
    select: { id: true },
  });
  return paste.id;
}

/** The prompt for a pasted posting, by its paste_id; the helper app's script (scripts/macos) has the same words. */
export const pastedPostingPrompt = (id: string) => promptFor("write", `with paste_id "${id}"`, "");

/** For a posting pasted into New application: keeps its text for Claude to read, and gives the chat to open, with the posting's id. */
export async function handOffPastedPosting(posting: { text: string; url: string }, now = new Date()): Promise<{ url: string; pasteId: string }> {
  const pasteId = await keepPastedPosting(posting, now);
  return { url: claudeChatUrl(pastedPostingPrompt(pasteId)), pasteId };
}

/**
 * The link the "DossierClaude" helper app on the user's Mac opens (scripts/macos): it starts Claude Code in
 * Terminal with the prompt for the pasted posting. The link carries only what to do and the posting's id, and
 * the helper writes the prompt itself (the same words as `pastedPostingPrompt`, which a test checks), so a web
 * page can't start Claude Code with a prompt of its own by opening one.
 */
export const CLAUDE_CODE_SCHEME = "dossier-claude";

/** For a posting pasted into New application: keeps its text for Claude to read, and gives the prompt and the link that starts Claude Code with it. */
export async function handOffPastedPostingToCode(posting: { text: string; url: string }, now = new Date()): Promise<{ prompt: string; link: string; pasteId: string }> {
  const pasteId = await keepPastedPosting(posting, now);
  return { prompt: pastedPostingPrompt(pasteId), link: `${CLAUDE_CODE_SCHEME}://write?paste_id=${pasteId}`, pasteId };
}

/** Remembers which application Claude saved from a pasted posting, so New application can open it. */
export async function linkPastedPosting(pasteId: string, applicationId: string): Promise<void> {
  if (!PASTE_ID.test(pasteId)) return;
  await prisma.claudePaste.updateMany({ where: { id: pasteId }, data: { applicationId } });
}

/** The application Claude saved from a pasted posting, or null while it hasn't (or once the posting is gone). */
export async function applicationFromPaste(pasteId: string): Promise<string | null> {
  if (!PASTE_ID.test(pasteId)) return null;
  const paste = await prisma.claudePaste.findUnique({ where: { id: pasteId }, select: { applicationId: true } });
  return paste?.applicationId ?? null;
}

/** What the helper app asks Claude Code to do for an application's email; its script has the same words. */
export const emailPrompt = (applicationId: string) =>
  `Using my Dossier connector: write the short email to send with my application with id "${applicationId}". ` +
  "Read the application with get_application and my profile with get_profile. Use only facts from my profile and the posting, and never guess an address. " +
  "Show me the email, then save it with save_email.";

/**
 * For an application's Email tab: the prompt to copy and the link the helper app opens. Claude Code writes the
 * resume and letter in a session named by the pasted posting's id, so the email can continue that very session
 * and Claude still has the posting, the profile and what it wrote; an application without one gets a new session.
 */
export async function handOffEmailToCode(applicationId: string): Promise<{ prompt: string; link: string }> {
  const paste = await prisma.claudePaste.findFirst({ where: { applicationId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const session = paste ? `&session=${paste.id}` : "";
  return { prompt: emailPrompt(applicationId), link: `${CLAUDE_CODE_SCHEME}://email?application_id=${applicationId}${session}` };
}

/** A pasted posting kept for Claude, or null once it's gone or expired. */
export async function readPastedPosting(id: string, now = new Date()): Promise<{ text: string; url: string } | null> {
  if (!PASTE_ID.test(id)) return null;
  const paste = await prisma.claudePaste.findUnique({ where: { id }, select: { text: true, url: true, expiresAt: true } });
  return paste && paste.expiresAt > now ? { text: paste.text, url: paste.url } : null;
}
