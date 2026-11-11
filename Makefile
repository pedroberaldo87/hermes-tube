# Development environment
# Paths come from the environment, with generic defaults:
#   HERMES_ROOT              Hermes folder (default: $HOME/.hermes)
#   HERMES_SRC               Hermes Agent checkout (default: $HERMES_ROOT/hermes-agent)
#   HERMES_TUBE_DEV_PROFILE  Hermes profile used for development (link-dev, status); no default
# REPO is the main checkout (in a worktree, the one of the common .git); without git, this Makefile's folder.
HERE      := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
GIT_COMMON:= $(shell git -C "$(HERE)" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
REPO      := $(if $(GIT_COMMON),$(patsubst %/,%,$(dir $(GIT_COMMON))),$(HERE))
HERMES_ROOT ?= $(HOME)/.hermes
HERMES_SRC  ?= $(HERMES_ROOT)/hermes-agent
HERMES_PY := $(HERMES_SRC)/venv/bin/python
HERMES_SP := $(HERMES_SRC)/venv/lib/python3.11/site-packages
VENV      := $(REPO)/.venv
DEV_PROFILE := $(HERMES_TUBE_DEV_PROFILE)
DEV_HOME  := $(HERMES_ROOT)/profiles/$(DEV_PROFILE)
PLUGIN_ID := $(shell sed -n 's/^PLUGIN_ID *= *"\(.*\)"/\1/p' $(REPO)/plugin/_id.py 2>/dev/null || true)

.PHONY: venv install-dev link-dev status need-profile

# project venv: the Hermes Python + the Hermes packages made visible (.pth) + test tools
venv:
	@test -x $(VENV)/bin/python || uv venv $(VENV) --python $(HERMES_PY) -q
	@printf '%s\n%s\n' "$(HERMES_SP)" "$(HERMES_SRC)" > $(VENV)/lib/python3.11/site-packages/hermes_paths.pth
	@if [ -f $(REPO)/pyproject.toml ] && grep -q '^\[dependency-groups\]' $(REPO)/pyproject.toml; then \
	  cd $(REPO) && uv pip install -q --python $(VENV)/bin/python --group dev -r pyproject.toml 2>/dev/null || \
	  uv pip install -q --python $(VENV)/bin/python pytest ruff pytest-timeout; \
	else \
	  uv pip install -q --python $(VENV)/bin/python pytest ruff pytest-timeout; \
	fi
	@$(VENV)/bin/python -c "import pytest, fastapi, yaml; print('venv ok', pytest.__version__)"

need-profile:
	@test -n "$(DEV_PROFILE)" || { echo "set HERMES_TUBE_DEV_PROFILE (the Hermes profile to develop in)"; exit 2; }

# links the main checkout into the development profile (linked plugin: the Desktop reloads on save)
link-dev: need-profile
	@test -n "$(PLUGIN_ID)" || { echo "plugin/_id.py does not exist yet"; exit 0; }
	@mkdir -p $(DEV_HOME)/plugins
	@ln -sfn $(REPO)/plugin $(DEV_HOME)/plugins/$(PLUGIN_ID)
	@hermes -p $(DEV_PROFILE) plugins enable $(PLUGIN_ID) >/dev/null 2>&1 || true
	@echo "$(DEV_PROFILE) → $(DEV_HOME)/plugins/$(PLUGIN_ID) -> $(REPO)/plugin"

install-dev: venv link-dev
	@cd $(REPO) && if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --loglevel=error; fi

status: need-profile
	@hermes -p $(DEV_PROFILE) plugins list 2>/dev/null | sed -n '1,40p'
