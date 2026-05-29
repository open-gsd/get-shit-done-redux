'use strict';

/**
 * no-elapsed-assertion
 *
 * Flag assert*() calls whose argument reads a property named
 * /^(elapsed|duration|took|ms)$/ or compares such an identifier.
 * Timing assertions are flaky and should not be in the test suite.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow timing assertions (elapsed, duration, took, ms) in assert calls',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      noElapsedAssertion:
        'Timing assertion detected: assert*() on a timing property (elapsed/duration/took/ms). Timing assertions are flaky — assert on observable behavior instead.',
    },
  },
  create(context) {
    const TIMING_PROPS = /^(elapsed|duration|took|ms)$/;

    function containsTimingRef(node) {
      if (!node) return false;

      // foo.elapsed, foo.duration, foo.took, foo.ms
      if (
        node.type === 'MemberExpression' &&
        node.property.type === 'Identifier' &&
        TIMING_PROPS.test(node.property.name)
      ) {
        return true;
      }

      // Identifier directly: elapsed, duration, took, ms
      if (node.type === 'Identifier' && TIMING_PROPS.test(node.name)) {
        return true;
      }

      // Binary expression: elapsed > 100, duration <= 500, etc.
      if (node.type === 'BinaryExpression') {
        return containsTimingRef(node.left) || containsTimingRef(node.right);
      }

      // Logical expression: elapsed && elapsed > 0
      if (node.type === 'LogicalExpression') {
        return containsTimingRef(node.left) || containsTimingRef(node.right);
      }

      // UnaryExpression: !elapsed
      if (node.type === 'UnaryExpression') {
        return containsTimingRef(node.argument);
      }

      return false;
    }

    function isAssertCall(node) {
      if (node.callee.type === 'Identifier') {
        return /^assert/.test(node.callee.name);
      }
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'assert'
      ) {
        return true;
      }
      // assert.strict.* or assert/strict
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'MemberExpression' &&
        node.callee.object.object.type === 'Identifier' &&
        node.callee.object.object.name === 'assert'
      ) {
        return true;
      }
      return false;
    }

    return {
      CallExpression(node) {
        if (!isAssertCall(node)) return;

        // Check all arguments for timing refs
        for (const arg of node.arguments) {
          if (containsTimingRef(arg)) {
            context.report({ node, messageId: 'noElapsedAssertion' });
            return;
          }
        }
      },
    };
  },
};

module.exports = rule;
