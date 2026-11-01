import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CLAUDE_CODE_SCHEME, emailPrompt, pastedPostingPrompt } from "./handoff";

// The DossierClaude helper app on the user's Mac (scripts/macos) writes its own prompt from a link, so a web
// page can't choose one. It has to say what Dossier copies to the clipboard.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/job-search/find", () => ({ fullText: vi.fn() }));

const script = readFileSync(path.resolve(process.cwd(), "scripts/macos/DossierClaude.applescript"), "utf8");
/** A text as AppleScript writes it inside a string. */
const inAppleScript = (text: string) => text.replaceAll('"', '\\"');

describe("the DossierClaude helper app's script", () => {
  it("writes the prompt Dossier copies to the clipboard, with the posting's id in the same place", () => {
    const [before, after, ...rest] = pastedPostingPrompt("<id>").split("<id>");
    expect(rest).toEqual([]);
    expect(script).toContain(inAppleScript(before));
    expect(script).toContain(inAppleScript(after));
  });

  it("writes the email prompt Dossier copies to the clipboard too", () => {
    const [before, after, ...rest] = emailPrompt("<id>").split("<id>");
    expect(rest).toEqual([]);
    expect(script).toContain(inAppleScript(before));
    expect(script).toContain(inAppleScript(after));
  });

  it("acts only on the two links Dossier opens, with plain ids", () => {
    expect(script).toContain(String.raw`${CLAUDE_CODE_SCHEME}://write\\?paste_id=([0-9a-fA-F-]{36})$`);
    expect(script).toContain(String.raw`${CLAUDE_CODE_SCHEME}://email\\?application_id=([A-Za-z0-9]{1,64})(&session=([0-9a-fA-F-]{36}))?$`);
  });

  it("starts in the folder the installer puts in, which is wherever the repository was cloned", () => {
    expect(script).toContain('property dossierFolder : "__DOSSIER_FOLDER__"');
    expect(script).toContain("set workDir to dossierFolder");
    const installer = readFileSync(path.resolve(process.cwd(), "scripts/macos/install-claude-launcher.sh"), "utf8");
    expect(installer).toContain("__DOSSIER_FOLDER__");
  });

  it("starts a posting's session under its own id, and continues it for the email when it's there", () => {
    expect(script).toContain("claude --session-id ");
    // The session is a file named by its id; without it, a new one starts rather than failing.
    expect(script).toContain('/" & sessionId & ".jsonl"');
    expect(script).toContain('; then claude --resume ');
    expect(script).toContain('; else claude ');
  });
});
