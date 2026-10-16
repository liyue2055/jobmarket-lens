# Spatial Lab task evaluation protocol

Status: prepared protocol; no participants recruited, results collected or claim of 3D benefit.
Use the [approved design](V2_5_1_3D_ANALYSIS_DESIGN.md) and
[completion scope](V2_5_1_DESIGN_COMPLETION.md). Keep 2D as default during evaluation.

Recruit 6–8 consenting novice and experienced analysts. Use anonymous participant IDs and collect
only task observations, completion times, mistakes and stated confidence. Do not collect account,
employment or LinkedIn profile information. Keep session notes private; publish only aggregate findings.

Use the pinned release, combined mode, default open inventory (82,851 postings), and recorded-mention
skill basis. For the diagnostic task explicitly switch to all statuses (86,190 postings). Clear drafts,
restore camera and reset filter/source/basis between tasks. Freeze exact reference selectors before
sessions and verify their counts and contributor hashes with the API; do not rely on visual guesses.

Counterbalance equal-data 2D and 3D task order across participants. Rotate task order and matched
examples to reduce learning effects. Both conditions retain the same evidence rail, exact list, selection
resolver and export. Record whether a participant switches to the exact fallback and why.

| Task | Success criterion | Failure/unsupported conclusion to record |
|---|---|---|
| Compare two occupation/level cells across arrangements | Identifies requested groups and exact counts; keeps Unknown visible; distinguishes camera/shelf isolation from applied filtering | Treats category spacing as numeric seniority or hides unknowns without reporting it |
| Find an employer with limited country/pay evidence | Reports numerator, denominator and exact employer count; distinguishes valid non-USD from invalid bounds | Calls missing pay an error or a universal quality score |
| Explain the 46 source-pair basis differences | On all statuses, states 46 basis differences and zero normalized availability disagreements | Calls all 46 availability errors or implies a change over time |
| Investigate recorded location differences | Reports six differences among 38 comparable pairs and eight unavailable; inspects actual contributors | Uses 46 as the comparable-location denominator or calls differences verified errors |
| Investigate a pair omitted by the graph | Uses exact matrix, names its basis, reports both marginals/support/Jaccard and resolves contributors | Infers zero co-mentions from a missing graph edge or interprets layout distance as measured similarity |
| Freeze A/B and recover evidence | Builds explicit drafts, applies, freezes selectors, reports exact overlap, exports matching contributor rows | Confuses union with sum, changes source mode unintentionally, or treats hover/camera as filtering |
| Recover from occlusion and graphics failure | Uses overlap list/camera reset, then completes contributor task in keyboard-accessible 2D | Loses applied selection or frozen pins; cannot reach evidence without WebGL |

For each task record completion, elapsed time, count/denominator errors, selection corrections,
unsupported claims, fallback use, assistance and confidence on a consistent 1–5 scale. Record exact
browser/device, input method, viewport and build SHA. Separately measure physical-device interaction,
picking, memory, thermal behavior and cold/warm network response; headless software-WebGL observations
do not substitute for these measurements.

Review paired outcomes descriptively. Any critical interpretation, accessibility or membership
regression blocks promotion of 3D as a default. Retain optional 3D only where tasks show useful benefit
without accuracy loss. With this small formative sample, do not claim population-wide significance or
causal proof of higher analyst productivity. Record changed design decisions and repeat affected tasks.
