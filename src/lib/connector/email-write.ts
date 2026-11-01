import "server-only";

import { z } from "zod";

import { guardSources, guardUnits } from "@/lib/ai/fact-guard";
import { withoutFrame } from "@/lib/ai/tasks/write-cover-letter";
import { recipient } from "@/lib/ai/tasks/write-email";
import { extractedOf } from "@/lib/application-data";
import { emailUnits } from "@/lib/application-email";
import { storeEmail } from "@/lib/jobs/write-email";
import { prisma } from "@/lib/prisma";
import { loadFactTexts, loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { TONES } from "@/lib/tones";

// The email that goes with an application, written in Claude chat or Claude Code and saved through the
// connector (save_email): the same parts as Dossier's own (src/lib/ai/tasks/write-email.ts), checked the same
// way, kept as the application's EMAIL document. So Dossier needs no AI model of its own for this.

/** Shown as what wrote the email, where Dossier would show a prompt version. */
export const EMAIL_WRITTEN_IN_CLAUDE = "claude-chat";

export const writtenEmailSchema = z.object({
  contact_name: z.string().max(200).nullable().default(null).describe("The person the posting says to send applications to, as it writes the name; null when it names no one"),
  contact_email: z.string().max(320).nullable().default(null).describe("The address the posting says to send applications to, exactly as it writes it; null when it gives none. Never guess one"),
  subject: z.string().min(1).max(300).describe("A clear subject with the role and the candidate's name, e.g. 'Application: Senior Product Designer, Jane Doe'; or the one the posting asks for"),
  greeting: z.string().max(200).default("").describe("e.g. 'Dear Acme team,', or the contact person by name when the posting names one"),
  paragraphs: z.array(z.string().min(1).max(2000)).min(1).max(5).describe("Two or three short paragraphs, about 80–150 words together, without greeting, sign-off or name: the resume and cover letter are attached, so don't repeat them"),
  sign_off: z.string().max(60).default("").describe("e.g. 'Warm regards,'; empty uses the tone's own"),
});

export type WrittenEmail = z.output<typeof writtenEmailSchema>;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Saves an email Claude wrote as the application's Email tab, or writes it again. The recipient is only an
 * address the posting contains. Answers with the recipient that was kept and the parts marked "check this",
 * or null when the application is gone.
 */
export async function saveWrittenEmail(applicationId: string, email: WrittenEmail): Promise<{ to: string; unverified: string[] } | null> {
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { documents: true, startup: { select: { emails: true } } } });
  if (!application) return null;
  const [profile, settings, facts] = await Promise.all([loadProfile(), loadSettings(), loadFactTexts(applicationId)]);

  // English emails get the tone's own sign-off, as letters do; other languages keep Claude's.
  const english = /^english$/i.test(application.language.trim() || "English");
  const signOff = english || !email.sign_off.trim() ? TONES[application.tone].signOff : email.sign_off.trim();
  const paragraphs = withoutFrame(email.paragraphs.map((text) => ({ text })), signOff)
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean);
  const body = [email.greeting.trim(), ...paragraphs, [signOff, profile.basics.name.trim()].filter(Boolean).join("\n")].filter(Boolean).join("\n\n");

  const [to, ...written] = emailUnits({ to: recipient(email.contact_name, email.contact_email, application.postingText), subject: oneLine(email.subject), body });
  const checked = settings.strict ? guardUnits(written, guardSources(profile, extractedOf(application), application.postingText, facts)) : written;
  const { units } = await storeEmail(application, [to, ...checked], EMAIL_WRITTEN_IN_CLAUDE);

  return {
    to: units.find((unit) => unit.id === "to")?.text ?? "",
    unverified: checked.flatMap((unit) => (unit.unverified?.length ? unit.unverified : [])),
  };
}
