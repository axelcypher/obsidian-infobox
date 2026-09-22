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

test('recognizes rendered footnote links without treating normal anchors as footnotes', () => {
    const plugin = new InfoboxPlugin();
    const footnote = {
        hasAttribute: name => name === 'data-footnote-ref',
        getAttribute: () => '#fn-1',
        closest: () => null
    };
    const normalLink = {
        hasAttribute: () => false,
        getAttribute: () => 'Notes/Source',
        closest: () => null
    };

    assert.equal(plugin.isFootnoteLink(footnote), true);
    assert.equal(plugin.isFootnoteLink(normalLink), false);
});

test('renders a known footnote as explicit superscript link markup', () => {
    const plugin = new InfoboxPlugin();
    const definitions = new Map([['1', 'Definition shown in the popup']]);

    const prepared = plugin.prepareFootnoteMarkdown('Source[^1] and [^missing]', definitions);

    assert.match(prepared.markdown, /<sup class="footnote-ref infobox-footnote-ref">/);
    assert.match(prepared.markdown, /<a href="#fn-1"[^>]*>1<\/a>/);
    assert.match(prepared.markdown, /\[\^missing\]/);
    assert.deepEqual(prepared.references, [{
        label: '1',
        display: '1',
        definition: 'Definition shown in the popup'
    }]);
});

test('sends explicit footnote link markup to the isolated Markdown renderer', () => {
    const plugin = new InfoboxPlugin();
    let renderedText = null;
    plugin.renderInlineTextFallback = (_parent, text) => { renderedText = text; };

    plugin.renderInlineText({}, 'Source[^1]', { path: 'Note.md' }, {}, new Map([
        ['1', 'Definition shown in the popup']
    ]));

    assert.match(renderedText, /<sup class="footnote-ref infobox-footnote-ref">/);
    assert.match(renderedText, /data-infobox-footnote-index="0"/);
});

test('adds hover behavior while keeping footnotes out of infobox link navigation', () => {
    const plugin = new InfoboxPlugin();
    const classes = new Set(['infobox-link']);
    const attributes = {};
    const listeners = {};
    const link = {
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name)
        },
        setAttribute: (name, value) => { attributes[name] = value; },
        addEventListener: (name, handler) => { listeners[name] = handler; }
    };

    plugin.prepareFootnoteLink(link, '1', 'Source text', { path: 'Note.md' }, {});

    assert.equal(classes.has('infobox-link'), false);
    assert.equal(classes.has('infobox-footnote-link'), true);
    assert.equal(attributes['data-infobox-footnote'], '1');
    assert.equal(typeof listeners.mouseenter, 'function');
    assert.equal(typeof listeners.focus, 'function');
    assert.equal(typeof listeners.click, 'function');
});

test('clicking a footnote reference moves the editor to its definition', () => {
    const plugin = new InfoboxPlugin();
    const calls = [];
    const event = {
        preventDefault: () => calls.push('preventDefault'),
        stopPropagation: () => calls.push('stopPropagation')
    };
    const link = { getAttribute: () => '#fn-1' };
    const editor = {
        getValue: () => 'Text[^1]\n\n[^1]: Source text',
        setCursor: position => calls.push(['setCursor', position]),
        scrollIntoView: range => calls.push(['scrollIntoView', range]),
        focus: () => calls.push('focus')
    };

    assert.equal(plugin.navigateToFootnote(event, link, '1', { editor }), true);
    assert.deepEqual(calls[2], ['setCursor', { line: 2, ch: 0 }]);
    assert.equal(calls.at(-1), 'focus');
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
