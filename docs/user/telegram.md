# HermesTube on Telegram: `/tube` and routines

HermesTube adds one command, `/tube`, and five routines. They work on any Hermes messaging platform that shows buttons; this guide uses Telegram. Connecting Telegram to Hermes is a Hermes feature, covered in the [Hermes docs](https://hermes-agent.nousresearch.com/docs).

Answers come in English or Brazilian Portuguese. The plugin's Language setting (Capabilities → Plugins → gear on the HermesTube row) decides; on `auto`, typing an English subcommand (`triage`, `cleanup`, `topic`, `tabs`, `routines`, `help`) answers in English and a Portuguese one (`triar`, `faxina`, `assunto`, `abas`, `rotinas`, `ajuda`) in Portuguese, and otherwise `/tube` and the routines follow Hermes's display language (`display.language`), falling back to English.

## How the buttons work

- Each question shows numbered options. Press one, or type its number.
- Any other reply, a timeout (90 s by default, the profile's `agent.clarify_timeout`) or "Other" stops the command without changing anything.
- Every answer is saved when you give it. To end a loop early, pick "stop": the Hermes `/stop` command does not stop it.
- One command asks at most 10 questions.

In the Desktop chat and the CLI there are no buttons: `/tube` answers in text and points you to the HermesTube page in Hermes Desktop.

Use `/tube` in a direct chat with your bot. In a group, channel or topic, where any member could read the answer or press its buttons, `/tube` shows nothing and approves nothing: it only replies that it works in a direct chat with the bot.

## Commands

| Command | What it does |
|---|---|
| `/tube` | summary: new videos, tabs with news, favorites that posted, extension status, the next video to triage |
| `/tube triage [n]` | up to `n` new videos (1 to 10), one question each: seen, later, archive, like, stop |
| `/tube cleanup` | the last cleanup scan, group by group, with approval |
| `/tube cleanup new` | scan again first (up to 1.5 minutes), then the same |
| `/tube topic <subject>` | builds a topic tab (up to 1.5 minutes), shows the preview and asks: save or not now |
| `/tube tabs` | your tabs with new-video counts |
| `/tube status` | refresh state, extension, queue |
| `/tube routines [keys]` | installs the routines, after one confirmation |
| `/tube routines remove [keys]` | removes them, after one confirmation |
| `/tube help` | the list above |

### Cleanup approval

`/tube cleanup` never cancels anything by itself. For each group (Inactive, Not watched, Off profile, Marked by you):

1. It lists the channels and asks "skip", "Unsubscribe these N" or "stop".
2. If you choose to unsubscribe, it asks again: "no, skip", "stop" or "Confirm (N)". Only "Confirm (N)" approves, whether you press it or type its number or text; a repeated "2" stops.
3. Approved channels go to the queue. The browser extension cancels them later, one at a time, in a visible tab on your computer. Until it runs, you can undo the approval in the Queue of the Cleanup section, in Hermes Desktop.

Channels can be resubscribed from Ex-subscriptions in the Cleanup section for 30 days.

### Asking in plain language

You can also just talk to Hermes in the chat: "what's new on YouTube?", "show me the new videos in my Science folder", "why don't I see channel X anymore?", "make a tab about home espresso". Hermes uses the plugin's tools for that. It does not cancel subscriptions; for that it points you to `/tube cleanup` or the Cleanup section.

## Routines

Install them from the Telegram chat where you want to receive them:

```text
/tube routines
```

Hermes asks once, with an Install and a Cancel button ("Instalar" and "Cancelar" in Portuguese). Pressing Install writes a small launcher script per routine into the profile's `scripts/` folder and creates one Hermes cron job per routine, delivering to this chat. Install only some with their keys, for example `/tube routines bom-dia favoritos`.

| Key | When | What you get | Uses the model? |
|---|---|---|---|
| `bom-dia` | 08:00 daily | new videos from Favorites and counts per tab | no |
| `favoritos` | every 30 minutes | a message only when a favorite channel posts | no |
| `resumo-pasta` | 19:00 daily | a short summary of new videos per folder | only when there is something new |
| `faxina-mensal` | day 1 of the month, 10:00 | the cleanup list and a pointer to `/tube cleanup`; it cancels nothing | no |
| `pasta-novos` | 09:00 daily | channels added recently without a folder | no |

Routines without news send nothing. Times use the profile's time zone. A sixth job, `hermes-tube-maintenance` (daily at 04:00), is installed with them; it does nothing in this version.

`resumo-pasta` is a Hermes agent job and runs on the profile's main model. To give it another model: `hermes cron list` to find its id, then `hermes cron edit <id> --model <model>`.

Hermes Desktop also offers three automation blueprints from the plugin (Cron page), under the same keys: a folder summary (`resumo-pasta`), the monthly cleanup list (`faxina-mensal`) and folder suggestions for new channels (`pasta-novos`; the model suggests, nothing is applied). Their text follows the same language rule. Jobs made from a blueprint always wake the agent, so they use the model on every run.

### Removing routines

```text
/tube routines remove
```

One confirmation, then the jobs and their scripts are removed. Without buttons (Desktop, CLI), nothing is removed; use `hermes cron list`, `hermes cron remove <id>` for each `hermes-tube-…` job, and delete the `hermes-tube-*.py` files in the profile's `scripts/` folder. Uninstalling the plugin does not remove routines, so do this first.
