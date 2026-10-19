\# Development Process



\## Rules

1\. \*\*GitHub is the master copy.\*\* Apps Script only receives code through `clasp push`.

2\. \*\*Never edit in the Apps Script browser editor.\*\* If you do, run `clasp pull`

&#x20;  before touching local files, then commit.

3\. \*\*Spec first.\*\* Every behavior change starts with an update to `docs/SPEC.md`.

4\. \*\*Commit only after a successful test run.\*\* Spec, code, and changelog changes go

&#x20;  in the same commit.



\## Locations

| What | Where |

|---|---|

| Repo | `C:\\Users\\BuyanThyagarajan\\GScriptTravelReceiptAutomation` |

| Script folder (run clasp here) | `...\\google-apps-script` |

| Apps Script project | StoreReceipts (ID in `.clasp.json`) |

| Output | My Drive › EigenX › Receipts › `yyyy-MM` |



\## One-time setup (new machine)

```

winget install OpenJS.NodeJS.LTS

winget install Git.Git

```

Open a \*\*new\*\* Command Prompt, then:

```

npm install -g @google/clasp

clasp login

git clone https://github.com/buyan47/GScriptTravelReceiptAutomation.git

```

\- Sign in to clasp as buyan47@gmail.com.

\- Turn on the Apps Script API: https://script.google.com/home/usersettings

\- `.clasp.json` is in the repo, so `clasp clone` is not needed.



\## Change loop



\*\*1. Start from the latest copy\*\*

```

cd C:\\Users\\BuyanThyagarajan\\GScriptTravelReceiptAutomation

git pull

```



\*\*2. Update the spec.\*\* Edit `docs/SPEC.md`: add or change the requirement (R#) and

its acceptance check (AC#).



\*\*3. Change the code.\*\* Edit `google-apps-script/TravelReceipts.gs`.



\*\*4. Deploy to Apps Script\*\*

```

cd google-apps-script

clasp push

```



\*\*5. Test\*\*

\- Set `BACKFILL\_START` / `BACKFILL\_END` to a short range (one month) and `clasp push`.

\- In Apps Script (StoreReceipts), select `backfillReceipts` → \*\*Run\*\*.

\- Check the Execution log, then run it a second time.

\- Check the files in Drive and go through acceptance criteria AC1–AC6.



\*\*6. Log the change.\*\* Add an entry at the top of `docs/CHANGELOG.md`.



\*\*7. Commit and push\*\*

```

git status

git add -A

git commit -m "R4: short description of the change"

git push

```

Start commit messages with the requirement ID the change relates to.



\## Rolling back

```

git log --oneline

git revert --no-edit <commit-id>

cd google-apps-script

clasp push

git push

```



\## Scheduled runs

\- Run `installWeeklyTrigger` once after any change to the trigger code.

\- Check the \*\*Triggers\*\* (clock icon) and \*\*Executions\*\* pages in Apps Script to

&#x20; confirm the weekly runs.



\## Troubleshooting

| Symptom | Fix |

|---|---|

| `'npm'` or `'clasp' is not recognized` | Install Node.js, open a new window. If still failing, add the folder from `npm prefix -g` to PATH, or use `npx @google/clasp <command>` |

| clasp error / "project file already exists" | Run from `google-apps-script`. Find stray copies: `dir %USERPROFILE%\\.clasp.json /a /s /b` |

| `clasp push` fails just after enabling the API | Wait a few minutes and retry |

| `clasp push` rejects the code | Syntax error; the message gives the file and line |

| "LF will be replaced by CRLF" | Harmless line-ending notice |

| GitHub sign-in page shows "127.0.0.1 refused to connect" | Rerun `git push` and approve promptly, or choose \*\*Sign in with a code\*\* |

| `git push` says "Everything up-to-date" | Check `git status` and `git log --oneline -3`; the push may already have succeeded |

| Run stops at 6 minutes | Use a shorter backfill range and run again; it resumes |

