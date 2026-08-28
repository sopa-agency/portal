#!/usr/bin/env bash
# Prova, por EVIDÊNCIA, que nenhum módulo server-only entrou no bundle do
# navegador.
#
# Por que isto existe: em 0809550 um import de VALOR atravessou a fronteira
# cliente/servidor e arrastou o caminho de chaves de RPC para o bundle. O `tsc`
# passou limpo — quem separa cliente de servidor é o bundler, não o compilador
# de tipos. O `next build` acusou, mas só porque o Next tem uma checagem
# própria; ela não cobre tudo, e "não deu erro" é ausência de evidência, não
# evidência de ausência.
#
# Este script inverte isso: procura, nos chunks que o NAVEGADOR baixa, strings
# que só existem dentro de módulos `server-only`. Achar qualquer uma é falha.
#
# Uso:  bash scripts/check-client-bundle.sh [dir-do-build]
set -uo pipefail

DIST="${1:-.next}"
CHUNKS="$DIST/static/chunks"

if [ ! -d "$CHUNKS" ]; then
  echo "✗ $CHUNKS não existe — rode o next build primeiro."
  exit 2
fi

# Cada marcador é uma string que aparece SOMENTE em código NOSSO de servidor.
#
# A primeira versão deste script usava strings de PROTOCOLO — `condenser_api`,
# `eth_getBalance` — e acusou vazamento na linha de base. Eram falsos positivos:
# vinham do @hiveio/dhive e do viem, bibliotecas que estão legitimamente no
# navegador. O instrumento não distinguia "nosso módulo de servidor vazou" de
# "uma biblioteca cliente fala o mesmo protocolo".
#
# Isso é o espelho exato do bug que este repo passou a noite consertando: um
# detector que mede o vizinho. E é pior que inútil — alarme falso é o que faz
# alguém desligar a verificação, e aí ela não protege mais nada.
#
# Por isso os marcadores agora são literais de string do NOSSO código, em
# português, dentro de arquivos com `import "server-only"`. Minificação renomeia
# variável; não reescreve literal de string.
MARKERS=(
  "posições de protocolo NÃO lidas"   # treasury.ts (server-only)
  "leitura falhou: "                  # treasury.ts (server-only)
  "chain desconhecida"                # treasury.ts (server-only)
  "api.zerion.io"                     # zerion.ts (server-only) — nenhuma lib usa
  "blue-api.morpho.org"               # community-vaults.ts (server-only)
  "ZERION_API_KEY"                    # nome da env, se um dia for inlinado
)

echo "Procurando marcadores de servidor em $CHUNKS"
echo "arquivos analisados: $(find "$CHUNKS" -name '*.js' | wc -l | tr -d ' ')"
echo

FOUND=0
for m in "${MARKERS[@]}"; do
  hits=$(grep -rl -- "$m" "$CHUNKS" --include='*.js' 2>/dev/null | head -5)
  if [ -n "$hits" ]; then
    echo "✗ VAZOU: \"$m\" está no bundle do cliente:"
    echo "$hits" | sed 's/^/    /'
    FOUND=1
  else
    echo "✓ ausente: \"$m\""
  fi
done

echo
if [ "$FOUND" -eq 1 ]; then
  echo "FALHA — código de servidor no bundle do navegador."
  exit 1
fi
echo "OK — nenhum marcador de servidor no bundle do navegador."
