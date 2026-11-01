import "server-only";

import { z } from "zod";

import { answerSchema, checkedProfile } from "@/lib/ai/tasks/extract-profile";
import { prisma } from "@/lib/prisma";
import { importCounts, type ImportedProfile } from "@/lib/profile-import";
import { applyImportedProfile } from "@/lib/profile-import-apply";
import { MAX_RESUME_CHARACTERS } from "@/lib/resume-text";

// A profile read from the user's resume by Claude and saved through the
// connector (import_profile). Claude does what Dossier's own model does for
// a resume import (the same shape, extract-profile's answer), so Dossier
// needs no AI model of its own for this. Code checks it the same way: dates
// in range, known language levels, skills once each, and every name looked
// up in the resume's text. It's merged into the profile like the import's
// Merge, without the preview: the file wins for what it says, nothing is
// deleted, and what it leaves out stays.

/** The resume's text as Claude read it, so the names it wrote can be looked up in it. */
export const readResumeSchema = z.string().trim().min(1).max(MAX_RESUME_CHARACTERS);

/** What a resume import's model answers. */
export const readProfileSchema = answerSchema;

export type ReadProfile = z.infer<typeof readProfileSchema>;

/** Merges the profile into Dossier's; answers with what was saved and the names the resume doesn't contain. */
export async function saveReadProfile({ resume, profile, today = new Date() }: { resume: string; profile: ReadProfile; today?: Date }): Promise<{ counts: string; unverified: string[] }> {
  const checked = checkedProfile(profile, resume, today);
  await applyImportedProfile(prisma, checked, "merge");
  return { counts: importCounts(checked), unverified: notInResume(checked) };
}

/** What the resume's text doesn't contain, once each: a skill, company or school Claude may have misspelled or made up. */
function notInResume(profile: ImportedProfile): string[] {
  const entries = [...profile.experience, ...profile.projects, ...profile.education, ...profile.publications, ...profile.references];
  const names = [...profile.skills.filter((skill) => !skill.found).map((skill) => skill.name), ...entries.flatMap((entry) => entry.unverified)];
  return [...new Set(names)];
}
