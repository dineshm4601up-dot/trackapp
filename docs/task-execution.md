# Task execution, delivery, cash and proof (Phase 8)

After a verified GPS check-in the agent taps **Start Task** (`CHECKED_IN → IN_PROGRESS`). The task screen then shows the execution form for the task type, the proof section, and a sticky **Review & complete** button. **Report a problem** (failure with a reason) stays available.

The browser only sends what happened: delivered quantities, the amount collected, the payment method and reference, and notes. The database function `agent_complete_task()` decides everything else (**COMPLETED vs PARTIALLY_COMPLETED**, timestamps, history and audit). No client-supplied status, agent, expected amount or timestamp is accepted.

## Execution per task type

| Type | Captured | Required to complete | Outcome |
|---|---|---|---|
| Deliver products | delivered quantity per line (0 ≤ delivered ≤ assigned, 3 dp), optional per-line note | every line, ≥ 1 **photo** proof, total > 0 | all lines full → `COMPLETED` "Full delivery"; any shortfall → `PARTIALLY_COMPLETED` "Partial delivery" + reason |
| Collect cash | collected amount (> 0, ≤ expected, 2 dp), payment method, reference, notes | method; reference for UPI / bank transfer / cheque | collected = expected → `COMPLETED`; less → `PARTIALLY_COMPLETED` + reason |
| Document collection | notes, partial toggle | ≥ 1 proof (photo or PDF) | `COMPLETED`, or partial + reason |
| Verification, inspection, survey | result notes, partial toggle | result notes | as above |
| Pickup, replacement, other | notes, partial toggle | — | as above |

- **Nothing delivered or nothing collected is not a completion** (`NOTHING_DELIVERED` / `NOTHING_COLLECTED`). The agent reports a failure instead.
- **A shortfall always needs a reason** (`REASON_REQUIRED`). The status history reason is `"Partial delivery: <reason>"`.
- **Stale-screen protection:** completion requires the task to still be `IN_PROGRESS` under a row lock. Parallel or duplicate submissions get one success, and the others get "This task has changed".

## Cash

- **Expected amount:** the admin sets `tasks.expected_amount` on the task form. It is required to assign a Collect Cash task. The agent cannot change it.
- **One record per task:** completion inserts one `cash_collections` row (unique per task) holding a snapshot of the expected amount, the collected amount, the method, the reference, `collected_at = now()` and the agent. A check constraint keeps collected ≤ expected.
- **Immutable once recorded:** agents have no UPDATE grant. An admin correction is a normal audited update (`CORRECT_CASH_COLLECTION`, old and new values in `audit_logs`).
- **No card data:** references are limited to 64 plain characters, and anything that looks like a card number (12–19 digits) is rejected (`SENSITIVE_REFERENCE`). The UI warns never to enter card numbers, CVV or PINs.

## Proof (photos and documents)

Proof lives in the **private** Storage bucket `task-proofs`:
- Limited to 10 MB.
- Allowed types are `image/jpeg`, `image/png`, `image/webp` and `application/pdf`.
- There is no public URL.

| Step | Where | Checks |
|---|---|---|
| 1. `createProofUpload` | server action | agent session; proof type ↔ MIME; size; task is the agent's and `CHECKED_IN`/`IN_PROGRESS`; **server generates** `tasks/{taskId}/proofs/{uuid}.{ext}` and asks for a signed upload URL *as the agent* |
| 2. Upload | browser → Storage | the bucket's INSERT policy (`can_upload_task_proof`) only allows that exact path shape, for the agent's own active task; bucket MIME/size limits |
| 3. `finalizeProof` | server action | path regex + task match; downloads as the agent; **magic bytes** must match the extension and proof type; SHA-256 |
| 4. `agent_add_task_proof()` | database | ownership, status, path, proof type, object exists, size ≤ `proof_max_file_bytes`, stored MIME matches type and extension, duplicate hash per task → `task_proofs` row |

- **Rejected uploads:** the object is removed with the server-only service client. Agents have no Storage UPDATE or DELETE permission, so proof is immutable.
- **Who can read:** admins and the assigned agent (`can_read_task_proof`). Pages render proofs through signed URLs that last 10 minutes.
- **File names:** the original name is kept as display text only and is never used in a path.

## Admin visibility

The task detail page (`/admin/tasks/[id]`) shows:
- **Products:** Assigned / Delivered / Outstanding per line, with delivery notes.
- **Cash collection card:** Expected / Collected / Outstanding, method, reference and time.
- **Proof gallery:** signed links to each file.
- **Activity:** the status history, including the summary and reason.

## Audit actions

| Action | When |
|---|---|
| `START_TASK` | task moves to `IN_PROGRESS` |
| `UPDATE_DELIVERY_QUANTITY` | delivered quantities recorded |
| `SUBMIT_CASH_COLLECTION` | cash recorded |
| `CORRECT_CASH_COLLECTION` | an admin corrects a cash record |
| `UPLOAD_TASK_PROOF` | proof registered |
| `COMPLETE_TASK` / `PARTIALLY_COMPLETE_TASK` | task completed or partially completed |
| `REPORT_TASK_FAILURE` | failure reported |

## Error codes (`agent_complete_task`)

`UNAUTHORIZED`, `TASK_NOT_FOUND`, `STATUS_CHANGED`, `TEXT_TOO_LONG`, `NO_PRODUCT_LINES`, `LINES_MISMATCH`, `QUANTITY_INVALID`, `NOTHING_DELIVERED`, `PROOF_REQUIRED`, `EXPECTED_AMOUNT_MISSING`, `COLLECTION_ALREADY_RECORDED`, `AMOUNT_INVALID`, `NOTHING_COLLECTED`, `OVER_COLLECTION`, `INVALID_PAYMENT_METHOD`, `REFERENCE_REQUIRED`, `REFERENCE_INVALID`, `SENSITIVE_REFERENCE`, `RESULT_REQUIRED`, `REASON_REQUIRED`. They are mapped to friendly messages in `src/features/execution/actions.ts`.
