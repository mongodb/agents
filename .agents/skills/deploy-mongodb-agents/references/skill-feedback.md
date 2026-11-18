# Send feedback on this skill

Use this when the user says this skill gave wrong guidance, left out a step,
or could be clearer. It's for the skill's instructions only.

Send other problems elsewhere:

- A bug in Atlas Explorer, Atlas Query Insights, or another part of this repo:
  point the user to the bug report form at
  <https://github.com/mongodb/agents/issues/new?template=bug_report.yml>.
- A problem with the `agentengine` or Atlas CLI, or with the platform itself:
  tell the user it's outside this repo.

## Rules

- **The issue is public.** `mongodb/agents` is a public repository, so anyone
  can read what you post. A deploy conversation often contains values that
  must not appear there.
- **Leave out every identifier.** Don't include Atlas project IDs (`GROUP_ID`),
  `mcpConfigId`, client IDs (`mdb_sa_id_...`), secrets (`mdb_sa_sk_...`), API
  keys, IP addresses, cluster, database, or collection names, organization or
  workspace names, email addresses, or file paths from the user's machine.
  Write a placeholder such as `<project-id>` instead.
- **Describe errors, don't paste them.** Summarize command output in your own
  words. If an exact error line matters, quote only that line, after removing
  any identifier from it.
- **Nothing is posted without a yes.** Show the user the exact title and body
  and wait for an explicit yes. A yes to sending feedback isn't a yes to the
  draft.

## Steps

1. **Ask.** Ask the user whether they'd like to send feedback to the skill's
   maintainers. If they say no, carry on with the task.
2. **Draft.** Fill in
   [assets/feedback-issue-template.md](../assets/feedback-issue-template.md)
   from the conversation. Name the file and section of this skill that caused
   the problem, for example `SKILL.md`, "1. Create the Atlas MCP
   configuration", step 6. Title it `user-feedback: <short summary>`.
3. **Check.** Reread the draft against the rules above and remove anything
   that identifies the user, their Atlas project, or their environment.
4. **Confirm.** Show the user the title and body. Say that the issue will be
   public. Make any changes they ask for, then wait for a yes.
5. **Submit.** Save the body to a temporary file and create the issue:

   ```bash
   gh issue create --repo mongodb/agents \
     --title "user-feedback: <short summary>" \
     --body-file "<path to the body file>"
   ```

   If `gh` isn't installed or isn't logged in, don't try to log in for the
   user. Give them the draft and this link to open the issue themselves:
   <https://github.com/mongodb/agents/issues/new>.
6. **Report.** Give the user the issue URL, then carry on with the task.
