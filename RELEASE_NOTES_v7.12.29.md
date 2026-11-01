## MARK v7.12.29 — Drill: review access for trainees who failed, and a retake lock

Download the `.msi` or `.exe` installer below. Requirements: Windows 10+.

### What's new
**Let a failed trainee see their answers — per quiz, or per trainee**
- **Quiz setting:** in **Admin → Quiz settings**, a Batch Manager can tick **"Let trainees who failed see their answers"** for a quiz. It applies at once, to attempts already made, for every trainee on that quiz.
- **One trainee:** trainers see **Allow review** / **Remove review** next to a trainee in the quiz **dashboard** and in the **Assign** panel (only for a trainee who has finished an attempt and has not passed).
- A trainee with access sees a **Review** button and the same clip-by-clip breakdown, with video, that a passed trainee sees. It covers every attempt. Their result still says "Not passed": review access never changes a score, the pass mark or whether anyone passed.
- A failed trainee **without** access sees the same hidden-answers message as before.

**The retake lock**
- A trainee who can see the answers **cannot start another attempt**: the quiz shows **"Retake is closed because you can see the answers"** instead of Retake or Start, and pressing Start is refused with the same message.
- A trainee's **first attempt is never blocked**, and a passed quiz stays closed.
- A trainer **grant** (an approved retake request, or **Reassign**) wins for **exactly one attempt**. While that attempt is unused or in progress the answers are hidden again, and they come back when it is submitted. **Reassign** also switches off that trainee's own review access (the quiz-wide setting is not touched).
- A trainee already **in the middle of an attempt** when access is granted can finish it. After it is submitted, no more attempts.
- Removing access lifts the lock; a trainee can then retake only if a trainer has approved a retake that has not been used.
- Every grant and removal is recorded in the `quiz_changes` tab (who, quiz, trainee, old and new value, when).

**Fixed: the start check**
- Pressing **Start** (and again on the intro screen of a new attempt) now re-reads the quiz, the trainee's assignment, their attempts and their retake grants **at that moment**, instead of using the list loaded earlier. A change a trainer made a minute ago counts immediately. If it cannot check, it does not start and says why.
- A pass on a **lowered pass mark** is now treated the same way in the start check as in the quiz list, so the Review button and the lock agree.

**Small addition:** the quiz dashboard shows **"Duplicate attempt number"** on a trainee's row if two of their attempts share a number (see below). Scores and history are unchanged.

### Know before you rely on it
- **The start check is made by the app on the trainee's computer (client-side), not by a server.** MARK reads and writes the sheet with its own account and there is no server in between. The check stops the honest mistake and a stale screen; a modified copy of the app could skip it.
- **The same trainee in two MARK windows at once** can both start on the last allowed retake, because nothing records an attempt as started until it finishes. Both attempts are kept (with the same attempt number) and the dashboard flags it. It is detected, not prevented.
- Three columns are added automatically on first use: `allow_review_on_fail` (quizzes), `review_allowed` (quiz_assignments) and `trainee_hr_code` (quiz_changes). A missing column counts as "off".

### Not changed
Scoring, pass marks, the stored `passed` field, Comparison, Tag, Scout, Audit, Insights, Self-Review and every other screen.
