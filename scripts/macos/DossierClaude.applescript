-- DossierClaude: the helper app behind Dossier's "Open in Claude Code" buttons.
--
-- A button opens a link, macOS hands it to this app (see install-claude-launcher.sh), and this app opens
-- Terminal in the Dossier folder (dossierFolder below) and starts Claude Code with a prompt:
--
--   dossier-claude://write?paste_id=<id>
--       A posting pasted into New application. Claude Code starts in a session named by that id, so the same
--       session can be continued later.
--   dossier-claude://email?application_id=<id>[&session=<id>]
--       The email for an application's Email tab. With a session that exists, it continues that session, so
--       Claude still has the posting, the profile and the resume and letter it wrote; otherwise it starts fresh.
--
-- The links only say what to do and which posting or application; the prompts are written here, never taken
-- from the link, so a web page can't start Claude Code with a prompt of its own. Anything that isn't one of the
-- two links with plain ids is ignored.
--
-- install-claude-launcher.sh puts the folder this repository is in where __DOSSIER_FOLDER__ is, so this
-- script isn't meant to be compiled by hand.
--
-- The prompts are the same ones Dossier copies to the clipboard (pastedPostingPrompt and emailPrompt in
-- src/lib/connector/handoff.ts); claude-launcher.test.ts checks the words match.

property dossierFolder : "__DOSSIER_FOLDER__"

on open location theURL
	set parsed to parseLink(theURL)
	if parsed is {} then return
	set linkKind to item 1 of parsed
	set linkId to item 2 of parsed
	set sessionId to item 3 of parsed

	set workDir to dossierFolder
	set shellStart to "export PATH=\"$HOME/.local/bin:$PATH\"; mkdir -p " & quoted form of workDir & " && cd " & quoted form of workDir & " && clear && "

	if linkKind is "write" then
		set thePrompt to "Using my Dossier connector: write a tailored resume and cover letter for the job posting with paste_id \"" & linkId & "\". Read it with get_posting and my profile with get_profile. Use only facts from my profile and tell me about any gaps. Show me a short summary and the fit, then save it with save_application."
		set theCommand to shellStart & "claude --session-id " & quoted form of linkId & " " & quoted form of thePrompt
	else
		set thePrompt to "Using my Dossier connector: write the short email to send with my application with id \"" & linkId & "\". Read the application with get_application and my profile with get_profile. Use only facts from my profile and the posting, and never guess an address. Show me the email, then save it with save_email."
		if sessionId is "" then
			set theCommand to shellStart & "claude " & quoted form of thePrompt
		else
			-- Claude Code keeps a session as a file named by its id, in a folder named by the working folder.
			set sessionFile to "$HOME/.claude/projects/$(pwd | sed 's/[^A-Za-z0-9]/-/g')/" & sessionId & ".jsonl"
			set theCommand to shellStart & "if [ -f \"" & sessionFile & "\" ]; then claude --resume " & quoted form of sessionId & " " & quoted form of thePrompt & "; else claude " & quoted form of thePrompt & "; fi"
		end if
	end if

	tell application "Terminal"
		activate
		do script theCommand
	end tell
end open location

-- {kind, id, session} from a link, or {} when it isn't one of the two links with plain ids.
on parseLink(theURL)
	set quotedURL to quoted form of theURL
	try
		set writeId to do shell script "printf '%s' " & quotedURL & " | sed -nE 's|^dossier-claude://write\\?paste_id=([0-9a-fA-F-]{36})$|\\1|p'"
		if writeId is not "" then return {"write", writeId, writeId}
		set emailIds to do shell script "printf '%s' " & quotedURL & " | sed -nE 's|^dossier-claude://email\\?application_id=([A-Za-z0-9]{1,64})(&session=([0-9a-fA-F-]{36}))?$|\\1 \\3|p'"
		if emailIds is "" then return {}
		set oldDelimiters to AppleScript's text item delimiters
		set AppleScript's text item delimiters to " "
		set parts to text items of emailIds
		set AppleScript's text item delimiters to oldDelimiters
		set applicationId to item 1 of parts
		set sessionId to ""
		if (count of parts) > 1 then set sessionId to item 2 of parts
		return {"email", applicationId, sessionId}
	on error
		return {}
	end try
end parseLink

-- Opened by hand instead of through a link.
on run
	activate
	display dialog "This app starts Claude Code in Terminal from Dossier's \"Open in Claude Code\" buttons. You don't need to open it yourself." buttons {"OK"} default button "OK" with title "DossierClaude"
end run
