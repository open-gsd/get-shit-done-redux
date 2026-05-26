'use strict';

const fs = require('fs');
const path = require('path');
const { output, error, ERROR_REASON } = require('./core.cjs');

function isBehaviorAddingTaskContent(content) {
  const tddTrue = /\btdd\s*=\s*["']true["']/i.test(content);

  const behaviorMatch = content.match(/<behavior>([\s\S]*?)<\/behavior>/i);
  const hasBehaviorBlock = Boolean(behaviorMatch && behaviorMatch[1].trim().length > 0);

  const filesMatch = content.match(/<files>([\s\S]*?)<\/files>/i);
  let hasSourceFiles = false;
  if (filesMatch) {
    const fileLines = filesMatch[1]
      .split(/[\n,]/)
      .map((line) => line.trim().replace(/^[-*]\s*/, ''))
      .filter(Boolean);
    hasSourceFiles = fileLines.some((file) =>
      !/\.md$/i.test(file) &&
      !/\.json$/i.test(file) &&
      !/\.test\.[^.]+$/i.test(file) &&
      !/\.spec\.[^.]+$/i.test(file) &&
      !/(^|[\\/])tests?[\\/]/i.test(file) &&
      !/\.(yml|yaml|toml|ini|cfg|conf|properties)$/i.test(file) &&
      !/(^|[\\/])\.env(\..+)?$/i.test(file)
    );
  }

  const isBehaviorAdding = tddTrue && hasBehaviorBlock && hasSourceFiles;
  const missing = [];
  if (!tddTrue) missing.push('tdd="true" frontmatter absent');
  if (!hasBehaviorBlock) missing.push('<behavior> block missing or empty');
  if (!hasSourceFiles) missing.push('<files> has no non-test source file');

  return {
    is_behavior_adding: isBehaviorAdding,
    checks: {
      tdd_true: tddTrue,
      has_behavior_block: hasBehaviorBlock,
      has_source_files: hasSourceFiles,
    },
    reason: isBehaviorAdding ? null : `Not behavior-adding: ${missing.join('; ')}`,
  };
}

function routeTaskCommand({ args, cwd, raw }) {
  const subcommand = args[1];
  if (subcommand !== 'is-behavior-adding') {
    error('Unknown task subcommand. Available: is-behavior-adding', ERROR_REASON.SDK_UNKNOWN_COMMAND);
  }

  let content = null;
  if (args[2] === '--task-content') {
    content = args[3] || null;
  } else if (args[2]) {
    const projectRoot = path.resolve(cwd || process.cwd());
    const requestedPath = args[2];
    const resolvedTaskPath = path.resolve(projectRoot, requestedPath);
    const rel = path.relative(projectRoot, resolvedTaskPath);
    if (rel === '..' || rel.startsWith(`..${path.sep}`)) {
      error(`Task file is outside project scope: ${requestedPath}`, ERROR_REASON.USAGE);
    }
    if (!fs.existsSync(resolvedTaskPath)) {
      error(`Task file not found: ${requestedPath}`, ERROR_REASON.USAGE);
    }
    content = fs.readFileSync(resolvedTaskPath, 'utf-8');
  }

  if (!content) {
    error('Usage: task.is-behavior-adding <plan-file-path> | --task-content "<xml>"', ERROR_REASON.USAGE);
  }

  output(isBehaviorAddingTaskContent(content), raw);
}

module.exports = {
  isBehaviorAddingTaskContent,
  routeTaskCommand,
};
