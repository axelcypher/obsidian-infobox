const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'obsidian') {
        return {
            Plugin: class Plugin {},
            Modal: class Modal {},
            FuzzySuggestModal: class FuzzySuggestModal {},
            debounce: fn => fn
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const InfoboxPlugin = require('../main.js');
const { extractFootnoteDefinitions } = InfoboxPlugin;

test.after(() => {
    Module._load = originalLoad;
});

test('extracts single-line, named, and multiline footnote definitions', () => {
    const source = [
        'Text with a footnote[^1] and a named one[^source].',
        '',
        '[^1]: First definition with **Markdown**.',
        '[^source]: First line',
        '  second line',
        '',
        '  final paragraph',
        '',
        '```md',
        '[^ignored]: This is an example, not a definition.',
        '```'
    ].join('\n');

    const definitions = extractFootnoteDefinitions(source);

    assert.equal(definitions.get('1'), 'First definition with **Markdown**.');
    assert.equal(definitions.get('source'), 'First line\nsecond line\n\nfinal paragraph');
    assert.equal(definitions.has('ignored'), false);
});

test('resolves known references and preserves unknown references', () => {
    const plugin = new InfoboxPlugin();
    const definitions = new Map([
        ['1', 'Resolved **content**'],
        ['source', 'Named source']
    ]);

    assert.equal(
        plugin.resolveFootnoteReferences('[^1] / [^source] / [^missing]', definitions),
        'Resolved **content** / Named source / [^missing]'
    );
});

test('uses the current editor contents so live-preview footnotes update immediately', () => {
    const plugin = new InfoboxPlugin();
    const file = { path: 'Notes/Test.md' };
    const view = {
        editor: { getValue: () => 'Body\n\n[^1]: Current editor value' }
    };

    const definitions = plugin.getFootnoteDefinitions(file, view, {});

    assert.equal(definitions.get('1'), 'Current editor value');
    assert.equal(plugin._footnoteDefinitions.get(file.path).get('1'), 'Current editor value');
});
