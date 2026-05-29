'use strict';

/**
 * no-magic-sleep-in-tests
 *
 * In *.test.cjs files, flag:
 *   - Atomics.wait used as a sleep
 *   - raw setTimeout used for synchronization (i.e., awaited or used without a callback driven by logic)
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Atomics.wait sleeps and raw setTimeout synchronization in test files',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      atomicsWaitSleep:
        'Atomics.wait() used as a sleep in tests. Use a proper async wait pattern instead.',
      setTimeoutSync:
        'Raw setTimeout used for synchronization in tests. Use proper async patterns (promises, events, polling) instead.',
    },
  },
  create(context) {
    const filename = context.getFilename();

    // Only applies in test files
    if (!filename.endsWith('.test.cjs')) return {};

    return {
      CallExpression(node) {
        // Atomics.wait(...)
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Atomics' &&
          node.callee.property.name === 'wait'
        ) {
          context.report({ node, messageId: 'atomicsWaitSleep' });
        }

        // setTimeout(...) used for synchronization:
        //   - await new Promise(resolve => setTimeout(resolve, N))
        //   - setTimeout(() => resolve(...), N) pattern
        //   - setTimeout(cb, N) where N is a numeric literal (magic delay)
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'setTimeout'
        ) {
          const args = node.arguments;
          // setTimeout(something, numericLiteral) — magic delay
          if (
            args.length >= 2 &&
            args[1].type === 'Literal' &&
            typeof args[1].value === 'number'
          ) {
            // Check if it's in an await expression or a Promise constructor
            const parent = node.parent;
            const grandParent = parent && parent.parent;
            const isInPromise =
              (grandParent &&
                grandParent.type === 'NewExpression' &&
                grandParent.callee.type === 'Identifier' &&
                grandParent.callee.name === 'Promise') ||
              (parent && parent.type === 'AwaitExpression');
            if (isInPromise) {
              context.report({ node, messageId: 'setTimeoutSync' });
            }
          }
        }
      },
    };
  },
};

module.exports = rule;
