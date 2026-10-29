( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  D=$(umask 077; mktemp -d) || exit 1
  F="$D/pw"; sent=0
  cleanup() {
    stty echo 2>/dev/null
    if [ -p "$F" ]; then
      if [ "$sent" -ne 1 ]; then exec 3<>"$F"; printf '\n' >&3; exec 3>&-; fi
      rm -f "$F"
    fi
    rmdir "$D" 2>/dev/null; pbcopy </dev/null 2>/dev/null; P=''
  }
  trap cleanup EXIT
  trap 'exit 130' INT TERM HUP
  (umask 077; mkfifo "$F") || exit 1
  printf 'FIFO=%s\n' "$F"
  printf 'Start the reader in terminal 1, then paste the password and press Enter: '
  read -rs P; echo
  printf 'len=%s\n' "${#P}"
  G=/usr/bin/grep; ok=1
  printf '%s' "$P" | $G -Eq '^[A-Za-z0-9]{40}$' || ok=0
  printf '%s' "$P" | $G -q '[a-z]' || ok=0
  printf '%s' "$P" | $G -q '[A-Z]' || ok=0
  printf '%s' "$P" | $G -q '[0-9]' || ok=0
  printf '%s' "$P" | $G -Eq '(.)\1\1'; [ $? -eq 1 ] || ok=0
  if [ "$ok" -ne 1 ]; then echo pw_bad_not_sent; exit 1; fi
  if printf '%s\n' "$P" > "$F"; then sent=1; echo pw_sent; else echo pw_write_failed; exit 1; fi
)
