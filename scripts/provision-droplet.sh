#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${TIMED_QUIZ_DEPLOY_HOST:-root@137.184.62.161}"
DEPLOY_REF="${TIMED_QUIZ_DEPLOY_REF:-timed-quiz-v0.1.0-rc1}"
REPOSITORY="${TIMED_QUIZ_REPOSITORY:-https://github.com/ref1972/timedquiz.git}"
NODE_VERSION="${TIMED_QUIZ_NODE_VERSION:-v24.14.0}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ssh "$DEPLOY_HOST" "mkdir -p /tmp/timed-quiz-provision"
scp "$PROJECT_DIR/ops/timed-quiz.service" "$DEPLOY_HOST:/tmp/timed-quiz-provision/timed-quiz.service"
scp "$PROJECT_DIR/ops/nginx-bee.conf" "$DEPLOY_HOST:/tmp/timed-quiz-provision/nginx-bee.conf"

ssh "$DEPLOY_HOST" bash -s -- "$DEPLOY_REF" "$REPOSITORY" "$NODE_VERSION" <<'REMOTE'
set -euo pipefail

DEPLOY_REF="$1"
REPOSITORY="$2"
NODE_VERSION="$3"
NODE_ARCHIVE="node-${NODE_VERSION}-linux-x64.tar.xz"

if [[ ! -x "/opt/node-${NODE_VERSION}-linux-x64/bin/node" ]]; then
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
  cd "$work_dir"
  curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}"
  curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
  grep " ${NODE_ARCHIVE}$" SHASUMS256.txt | sha256sum -c -
  tar -xJf "$NODE_ARCHIVE" -C /opt
fi
ln -sfn "/opt/node-${NODE_VERSION}-linux-x64" /opt/timed-quiz-node

if ! id timedquiz >/dev/null 2>&1; then
  useradd --system --home /var/lib/timed-quiz --shell /usr/sbin/nologin timedquiz
fi
install -d -o timedquiz -g timedquiz -m 0750 /var/lib/timed-quiz
install -d -o timedquiz -g timedquiz -m 0750 /var/backups/timed-quiz

if [[ ! -d /var/www/timed-quiz/.git ]]; then
  git clone "$REPOSITORY" /var/www/timed-quiz
fi
cd /var/www/timed-quiz
git fetch --tags origin
git checkout --detach "$DEPLOY_REF"
PATH="/opt/timed-quiz-node/bin:$PATH" npm ci --omit=dev
chown -R root:root /var/www/timed-quiz

if [[ ! -f /etc/timed-quiz.env ]]; then
  admin_password="$(openssl rand -base64 36 | tr -d '\n')"
  session_secret="$(openssl rand -base64 48 | tr -d '\n')"
  invitation_key="$(openssl rand -base64 48 | tr -d '\n')"
  install -m 0600 /dev/null /etc/timed-quiz.env
  printf '%s\n' \
    'NODE_ENV=production' \
    'HOST=127.0.0.1' \
    'PORT=8080' \
    'APP_ORIGIN=https://bee.triviaworkshop.com' \
    'DB_PATH=/var/lib/timed-quiz/quiz.db' \
    "ADMIN_PASSWORD=${admin_password}" \
    "SESSION_SECRET=${session_secret}" \
    "INVITATION_ENCRYPTION_KEY=${invitation_key}" \
    'EMAIL_RELAY_URL=' \
    'EMAIL_RELAY_SECRET=' \
    'QUESTION_DURATION_MS=20000' \
    'SUBMIT_GRACE_MS=2000' \
    "RELEASE_ID=${DEPLOY_REF}" > /etc/timed-quiz.env
fi

if [[ ! -f /var/lib/timed-quiz/quiz.db ]]; then
  set -a
  source /etc/timed-quiz.env
  set +a
  runuser -u timedquiz -- env PATH="/opt/timed-quiz-node/bin:/usr/bin:/bin" \
    /opt/timed-quiz-node/bin/npm run seed > /root/timed-quiz-seed-output.txt
  chmod 0600 /root/timed-quiz-seed-output.txt
fi

install -o root -g root -m 0644 /tmp/timed-quiz-provision/timed-quiz.service /etc/systemd/system/timed-quiz.service
install -o root -g root -m 0644 /tmp/timed-quiz-provision/nginx-bee.conf /etc/nginx/sites-available/bee.triviaworkshop.com
ln -sfn /etc/nginx/sites-available/bee.triviaworkshop.com /etc/nginx/sites-enabled/bee.triviaworkshop.com

systemctl daemon-reload
systemctl enable --now timed-quiz.service
nginx -t
systemctl reload nginx

curl -fsS http://127.0.0.1:8080/health
systemctl --no-pager --full status timed-quiz.service
REMOTE
