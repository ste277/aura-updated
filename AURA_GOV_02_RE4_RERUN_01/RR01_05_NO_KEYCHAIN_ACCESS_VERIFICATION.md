# RR01-05: No Keychain Access

- **Static:** the extracted block contains no `security`, `sec_`, `glob_state`, `Keychains`, `pkill` or `killall`. The probe checks this before running and refuses on any match, and the reviewer confirmed it.
- **Runtime:**
  - Every Keychain-reaching function was a tripwire, and **none fired**.
  - The probe defines no `SEC` variable.
  - The only programs it ran: `ps`, `mktemp`, `rm`, `mkdir`, `rmdir`, `stat`, `shasum`, `awk`, `sort`, `wc`, `cmp`, `date`, `sw_vers`, `id`, and the `sleep` polling inside `ps_read`.
- **Harness equivalence:** on a T1-6 stop, the real cleanup reaches no `security` call (RR01-02 #3; reviewer RR-5).
- **Not done:** no real `security` command, no Keychain file or folder read, no credential or passphrase requested.
