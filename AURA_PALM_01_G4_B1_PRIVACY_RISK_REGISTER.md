# AURA-PALM-01-G4-B1: Privacy Risk Register

**Not legal advice or approval.** Jurisdiction-specific items are marked ⚖ and need qualified privacy/legal review.

## 1. Is a palm photo personal or biometric data?

| Question | Assessment | Status |
|---|---|---|
| Personal data? | A palm photo of an identifiable or code-linked participant is very likely **personal data** in most regimes (data relating to an identifiable person, directly or via the code key) | ⚖ confirm |
| Biometric data? | Palm creases and palm prints can uniquely identify people. **Some laws define biometrics by data type**, e.g. Illinois BIPA covers "scan of hand or face geometry", which may include extracting hand landmarks from photos. **Others by purpose**: GDPR Art. 9 makes biometric data special-category when processed *for unique identification*, which this research does not do, but it still involves personal data and possibly a DPIA. India's DPDP Act 2023 covers digital personal data and requires notice and consent | ⚖ **Unresolved:** depends on where participants live and where processing happens |
| Consent requirements | Likely **explicit, informed, written** consent, with a clear purpose, retention and withdrawal. Some laws require a published retention schedule and written release (BIPA) | ⚖ **Unresolved** |

## 2. Risks

| ID | Risk | Likelihood | Impact | Mitigation | Residual / owner decision |
|---|---|---|---|---|---|
| R-01 | Photos stored in the repository or synced to the cloud by accident | Medium | High | Storage outside the repo and synced folders; encrypted volume; transfer by USB only; no AirDrop or email; optional pre-commit hook | Low, if the storage plan is followed |
| R-02 | Unauthorised access to images (device theft, shared account) | Low–Medium | High | AES-256 sparse images; owner-only permissions; unmount when idle; FileVault on the Mac (owner to confirm) | Owner confirms FileVault |
| R-03 | Hidden metadata (GPS, device serial, time) in photos | High (phones embed EXIF) | Medium | Strip EXIF/XMP/GPS inside the volume before storage; verification step; HEIC → JPEG locally | Tool choice needed (`exiftool` not installed) |
| **R-04** | **AI agents / dev tools transmit images.** Opening, reading or screenshotting a participant image (or a page that renders it) through an AI assistant sends it to the model provider. Browser-pane screenshots and file reads count | **High** if unmanaged | High | **Hard rule:** AI assistants never open, read, screenshot or describe participant images, and never view the app or evaluation pages while they render participant images. The harness writes **aggregate JSON only**; agents read only that. The evaluation page has no image gallery (the validation gallery isn't used with real data) | Owner acknowledges and enforces |
| R-05 | MediaPipe telemetry leaves the device | Medium (attempted every session) | Medium | CSP `connect-src 'self'` + network guard (verified blocking); never weakened | Low (desktop-verified; phones unverified) |
| R-06 | Identifying features in frame (face, tattoos, rings, documents) | Medium | Medium | Hand-only framing; jewellery removed; delete and retake; annotators mark unsuitable | Low |
| R-07 | Demographic inference (skin tone estimated from photos) | Medium (old draft/register allowed it) | Medium (sensitive data, fairness) | **Prohibited:** self-report only, optional; tool change to remove annotator estimation | Owner decision A-07 (criteria impact) |
| R-08 | Withdrawal can't be honoured (copies scattered) | Low | Medium | Single encrypted location; backup copies logged; deletion procedure; deletion log | Low |
| R-09 | Retention overrun | Medium | Medium | Fixed retention date in consent; calendar reminder; delete containers at end | Owner sets date |
| R-10 | Insecure disposal on SSD | Medium | Medium | Delete the encrypted container + discard the passphrase (crypto-erase); also delete backups | Low |
| R-11 | Phone-side residue (camera roll, cloud photo backup, "Recently Deleted") | High | Medium | Cloud photo sync off during sessions or a dedicated phone; delete including Recently Deleted; verify | Owner confirms process |
| R-12 | Coercion / power imbalance (e.g. employees or family as participants) | Medium | Medium | Voluntary participation; easy withdrawal; no incentives tied to staying in | ⚖ ethics review may be advisable |
| R-13 | Re-identification via the code key | Low | High | Key (if any) only in the CONSENT volume with a separate passphrase, or no key (contact-free withdrawal by code) | Owner decides whether a key is needed |
| R-14 | Evaluation outputs leak data | Low | Low–Medium | Outputs hold codes, coordinates and metrics only; stored in the DATA volume; deleted with the dataset | Low |
| R-15 | Spotlight / Quick Look / thumbnail caches keep copies | Medium | Low–Medium | Indexing off on the volumes; don't open images outside the volume; clear Quick Look cache after the study (`qlmanage -r cache`) | Low |

## 3. Unresolved jurisdiction-specific requirements ⚖

1. Which laws apply: participants' locations (e.g. India, US states including Illinois, Texas and Washington, EU/UK) and the researcher's location.
2. Whether palm photos plus landmark extraction count as biometric identifiers or "hand geometry" under applicable laws.
3. Required consent form elements (written release, retention schedule publication, specific notices, language).
4. Whether a DPIA or ethics review is required or advisable.
5. Lawful basis and controller identity; data-subject rights handling (access, deletion) and response deadlines.
6. Cross-border transfer: none planned (local only). Confirm no cloud tools are used.

**Recommendation:** obtain qualified privacy/legal review before collection (approval checklist A-02).
