const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
let nextItemID = 1000;

function loadScripts(files) {
    const progressWindows = [];
    class MockItemProgress {
        constructor(icon, message) {
            this.icon = icon;
            this.message = message;
            this.progress = null;
            this.error = false;
        }

        setProgress(progress) {
            this.progress = progress;
        }

        setText(message) {
            this.message = message;
        }

        setIcon(icon) {
            this.icon = icon;
        }

        setError() {
            this.error = true;
        }
    }

    class MockProgressWindow {
        constructor() {
            this.ItemProgress = MockItemProgress;
            this.items = [];
            this.headline = '';
            this.showCount = 0;
            progressWindows.push(this);
        }

        changeHeadline(headline) {
            this.headline = headline;
        }

        show() {
            this.showCount++;
        }

        startCloseTimer(timer) {
            this.closeTimer = timer;
        }
    }

    const context = vm.createContext({
        console,
        setTimeout,
        clearTimeout,
        Headers,
        URL,
        Services: {
            strings: {
                createBundle(uri) {
                    const file = uri.replace('test://zotmeta/', 'src/');
                    const entries = Object.fromEntries(fs.readFileSync(path.join(repoRoot, file), 'utf8')
                        .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
                            const split = line.indexOf('=');
                            return [line.slice(0, split).trim(), line.slice(split + 1).trim()
                                .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))];
                        }));
                    return { GetStringFromName(key) {
                        if (!(key in entries)) throw new Error('Missing string: ' + key);
                        return entries[key];
                    } };
                }
            },
            prefs: {
                values: {},
                getIntPref(name, fallback) {
                    return Object.prototype.hasOwnProperty.call(this.values, name)
                        ? this.values[name]
                        : fallback;
                },
                setIntPref(name, value) {
                    this.values[name] = value;
                },
                getStringPref(name, fallback) {
                    return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name] : fallback;
                },
                setStringPref(name, value) {
                    this.values[name] = value;
                },
                getBoolPref(name, fallback) {
                    return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name] : fallback;
                },
                setBoolPref(name, value) {
                    this.values[name] = value;
                }
            }
        },
        fetch: async () => {
            throw new Error('Unexpected fetch call');
        },
        Zotero: {
            ItemTypes: {
                getID(type) {
                    return type;
                },
                getName(type) {
                    return type;
                }
            },
            Items: {
                byID: {},
                all: [],
                get(id) {
                    return this.byID[id];
                },
                getAll() {
                    return this.all;
                }
            },
            Fulltext: {
                getItemCacheFile(item) {
                    return item.cacheText ? { exists: () => true, item } : null;
                }
            },
            File: {
                async getContentsAsync(cacheFile) {
                    return cacheFile.item.cacheText || '';
                }
            },
            ProgressWindow: MockProgressWindow,
            Utilities: {
                Internal: {
                    openedPreferenceIDs: [],
                    openPreferences(paneID) {
                        this.openedPreferenceIDs.push(paneID);
                    }
                }
            },
            debug() {}
        },
        __progressWindows: progressWindows
    });

    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'src/chrome/content/l10n.js'), 'utf8'), context);
    context.ZotMetaL10n.init('test://zotmeta/');
    for (const file of files) {
        const code = fs.readFileSync(path.join(repoRoot, file), 'utf8');
        vm.runInContext(code, context, { filename: file });
    }
    vm.runInContext(`
        this.ThreadPool = typeof ThreadPool !== 'undefined' ? ThreadPool : this.ThreadPool;
    `, context);
    return context;
}

function makeItem(fields, itemTypeID = 'preprint') {
    return {
        id: nextItemID++,
        libraryID: 1,
        itemTypeID,
        fields: Object.assign({}, fields),
        creators: [],
        tags: [],
        saved: false,
        getField(field) {
            return this.fields[field] || '';
        },
        setField(field, value) {
            if (this.itemTypeID === 'preprint' && field === 'publicationTitle') {
                throw new Error("'publicationTitle' is not a valid field for type 'preprint'");
            }
            this.fields[field] = value;
        },
        setCreators(creators) {
            this.creators = creators;
        },
        getTags() {
            return this.tags.map(tag => ({ tag }));
        },
        addTag(tag) {
            if (!this.tags.includes(tag)) {
                this.tags.push(tag);
            }
        },
        removeTag(tag) {
            this.tags = this.tags.filter(candidate => candidate !== tag);
        },
        isRegularItem() {
            return true;
        },
        isAttachment() {
            return false;
        },
        getAttachments() {
            return this.attachmentIDs || [];
        },
        async saveTx() {
            this.saved = true;
        }
    };
}

function makeAttachment(fields = {}) {
    const attachment = makeItem(fields, 'attachment');
    attachment.itemTypeID = 'attachment';
    attachment.attachmentContentType = 'application/pdf';
    attachment.attachmentFilename = fields.filename || fields.title || 'attachment.pdf';
    attachment.parentID = fields.parentID || null;
    attachment.cacheText = fields.cacheText || '';
    attachment.isRegularItem = () => false;
    attachment.isAttachment = () => true;
    return attachment;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function createFakeWindow() {
    class FakeElement {
        constructor(ownerDocument, tagName) {
            this.ownerDocument = ownerDocument;
            this.tagName = tagName;
            this.children = [];
            this.parentNode = null;
            this.style = {};
            this.style.setProperty = (key, value) => { this.style[key] = value; };
            this.dataset = {};
            this.clientWidth = 520;
            this.attributes = {};
            this.textContent = '';
            this.className = '';
            this.id = '';
            this.listeners = {};
            this.classList = {
                values: [],
                add: (...classes) => {
                    for (const className of classes) {
                        if (!this.classList.values.includes(className)) {
                            this.classList.values.push(className);
                        }
                    }
                }
            };
        }

        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }

        removeChild(child) {
            this.children = this.children.filter(candidate => candidate !== child);
            child.parentNode = null;
        }

        setAttribute(name, value) {
            this.attributes[name] = value;
        }

        getAttribute(name) {
            return this.attributes[name] || null;
        }

        removeAttribute(name) {
            delete this.attributes[name];
        }

        addEventListener(name, listener) {
            this.listeners[name] = listener;
        }
    }

    function createFakeDocument() {
        const document = {
            documentElement: null,
            body: null,
            createElementNS(namespace, tagName) {
                return new FakeElement(document, tagName);
            },
            getElementById(id) {
                function find(element) {
                    if (!element) {
                        return null;
                    }
                    if (element.id === id) {
                        return element;
                    }
                    for (const child of element.children) {
                        const found = find(child);
                        if (found) {
                            return found;
                        }
                    }
                    return null;
                }
                return find(document.documentElement);
            },
            open() {},
            write() {
                this.documentElement = new FakeElement(this, 'html');
                this.body = new FakeElement(this, 'body');
                this.documentElement.appendChild(this.body);
            },
            close() {}
        };
        document.documentElement = new FakeElement(document, 'root');
        document.body = new FakeElement(document, 'body');
        document.documentElement.appendChild(document.body);
        return document;
    }

    const document = createFakeDocument();
    const fakeWindow = {
        document,
        lastTimeout: null,
        openedWindows: [],
        setTimeout(callback, timeout) {
            this.lastTimeout = timeout;
            return 1;
        },
        clearTimeout() {},
        focus() {},
        open() {
            const child = createFakeWindow();
            this.openedWindows.push(child);
            return child;
        }
    };
    return fakeWindow;
}

function createLegacyFakeWindow() {
    class FakeElement {
        constructor(ownerDocument, tagName) {
            this.ownerDocument = ownerDocument;
            this.tagName = tagName;
            this.children = [];
            this.parentNode = null;
            this.style = {};
            this.attributes = {};
            this.textContent = '';
            this.className = '';
            this.id = '';
            this.listeners = {};
            this.classList = {
                values: [],
                add: (...classes) => {
                    for (const className of classes) {
                        if (!this.classList.values.includes(className)) {
                            this.classList.values.push(className);
                        }
                    }
                }
            };
        }

        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }

        removeChild(child) {
            this.children = this.children.filter(candidate => candidate !== child);
            child.parentNode = null;
        }

        setAttribute(name, value) {
            this.attributes[name] = value;
        }

        addEventListener(name, listener) {
            this.listeners[name] = listener;
        }
    }

    const document = {
        documentElement: null,
        createElementNS(namespace, tagName) {
            return new FakeElement(document, tagName);
        },
        getElementById(id) {
            function find(element) {
                if (element.id === id) {
                    return element;
                }
                for (const child of element.children) {
                    const found = find(child);
                    if (found) {
                        return found;
                    }
                }
                return null;
            }
            return find(document.documentElement);
        }
    };
    document.documentElement = new FakeElement(document, 'root');

    const fakeWindow = {
        document,
        lastTimeout: null,
        setTimeout(callback, timeout) {
            this.lastTimeout = timeout;
            return 1;
        },
        clearTimeout() {}
    };
    return fakeWindow;
}

async function testThreadPoolConcurrency(ThreadPool) {
    const pool = new ThreadPool(6);
    let running = 0;
    let maxRunning = 0;
    const completed = [];

    for (let index = 0; index < 18; index++) {
        pool.submit(async () => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            assert.ok(running <= 6, 'more than 6 jobs ran at once');
            await new Promise(resolve => setTimeout(resolve, 10));
            completed.push(index);
            running--;
        });
    }

    pool.execute();
    await pool.wait();
    assert.equal(completed.length, 18);
    assert.equal(maxRunning, 6);
}

function testModernProgressPanel(Utilities) {
    const fakeWindow = createFakeWindow();
    const handle = Utilities.initializeModernProgress(fakeWindow, 'Updating metadata', 'Preparing metadata updates...');
    assert.equal(handle.type, 'modern');
    assert.equal(handle.titleElement.textContent, 'Updating metadata');
    assert.equal(handle.summaryElement.textContent, 'Preparing metadata updates...');

    const batchItem = Utilities.addProgressItem(handle, 'Batch 1: queued 10 items');
    Utilities.updateProgressItem(batchItem, 50, 'Batch 1: 5/10 checked');
    assert.equal(batchItem.row.children[0].textContent, 'Batch 1: 5/10 checked');
    assert.equal(batchItem.row.children[1].children[0].style.width, '50%');

    Utilities.publishFinishedProgress(handle, '10 items updated.', 'Metadata updated', false);
    assert.equal(handle.titleElement.textContent, 'Metadata updated');
    assert.equal(handle.summaryElement.textContent, '10 items updated.');
    assert.equal(handle.fill.style.width, '100%');
    assert.equal(fakeWindow.lastTimeout, 8000);
}

async function waitForQueueToFinish(ZotMeta) {
    for (let index = 0; index < 100; index++) {
        if (!ZotMeta.updateProgressHandle && ZotMeta.updateActiveCount === 0 && ZotMeta.updateQueue.length === 0) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for metadata queue');
}

async function testSharedUpdatePopup(context) {
    const { Zotero, ZotMeta, Book, __progressWindows } = context;
    let running = 0;
    let maxRunning = 0;
    let completed = 0;
    let saveRunning = false;

    Book.updateMetadata = async (item) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        assert.ok(running <= 6, 'metadata queue exceeded concurrency limit');
        await new Promise(resolve => setTimeout(resolve, 10));
        await context.Utilities.saveItemTx(item);
        completed++;
        running--;
        return 0;
    };

    function makeSaveSensitiveItem(title) {
        const item = makeItem({ title }, 'book');
        item.saveTx = async () => {
            assert.equal(saveRunning, false, 'saveTx calls overlapped');
            saveRunning = true;
            await new Promise(resolve => setTimeout(resolve, 2));
            saveRunning = false;
            item.saved = true;
        };
        return item;
    }

    const firstSelection = Array.from({ length: 10 }, (_, index) => makeSaveSensitiveItem('First ' + index));
    const secondSelection = Array.from({ length: 10 }, (_, index) => makeSaveSensitiveItem('Second ' + index));

    Zotero.getActiveZoteroPane = () => ({
        getSelectedItems() {
            return firstSelection;
        }
    });
    await ZotMeta.updateSelectedItemsMetadata();

    Zotero.getActiveZoteroPane = () => ({
        getSelectedItems() {
            return secondSelection;
        }
    });
    await ZotMeta.updateSelectedItemsMetadata();

    await waitForQueueToFinish(ZotMeta);
    assert.equal(completed, 20);
    assert.equal(maxRunning, 6);
    assert.equal(__progressWindows.length, 1);
    assert.equal(__progressWindows[0].headline, 'Metadata updated');
}

async function testUpdateRetry(context) {
    const { ZotMeta } = context;
    let attempts = 0;
    const updater = {
        async updateMetadata() {
            attempts++;
            return attempts === 1 ? 1 : 0;
        }
    };

    const status = await ZotMeta.updateItemWithRetry(updater, makeItem({ title: 'Retry me' }, 'book'));
    assert.equal(status, 0);
    assert.equal(attempts, 2);
}

async function testStatusTags(context) {
    const { Utilities, Services } = context;
    const failedItem = makeItem({ title: 'Failed item' }, 'book');
    assert.equal(Utilities.shouldTagFailedItems(), false);
    await Utilities.markItemUpdateStatus(failedItem, 1);
    assert.deepEqual(failedItem.tags, [], 'Failure tags should be off by default');
    assert.equal(failedItem.saved, false, 'Disabled tagging should not trigger a save');

    Services.prefs.setBoolPref(Utilities.tagFailedItemsPref, true);
    await Utilities.markItemUpdateStatus(failedItem, 1);
    assert.deepEqual(failedItem.tags, ['ZotMeta: Failed']);
    failedItem.saved = false;
    await Utilities.markItemUpdateStatus(failedItem, 1);
    assert.deepEqual(failedItem.tags, ['ZotMeta: Failed'], 'Do not duplicate failure tags');
    assert.equal(failedItem.saved, false);

    Services.prefs.setBoolPref(Utilities.tagFailedItemsPref, false);
    await Utilities.markItemUpdateStatus(failedItem, 1);
    assert.deepEqual(failedItem.tags, ['ZotMeta: Failed'], 'Disabling the setting preserves existing failure tags');
    failedItem.addTag('My tag');

    await Utilities.markItemUpdateStatus(failedItem, 0);
    assert.deepEqual(failedItem.tags, ['My tag'], 'Success removes stale failure tags without touching user tags');

    Services.prefs.setBoolPref(Utilities.tagFailedItemsPref, true);
    const skippedItem = makeItem({ title: 'Skipped item' }, 'book');
    await Utilities.markItemUpdateStatus(skippedItem, 2);
    assert.deepEqual(skippedItem.tags, ['ZotMeta: Skipped']);

    await Utilities.markItemUpdateStatus(skippedItem, 1);
    assert.deepEqual(skippedItem.tags, ['ZotMeta: Failed']);
    delete Services.prefs.values[Utilities.tagFailedItemsPref];
}

async function testIdentifierExtraction(context) {
    const { Utilities, Zotero, ZotMeta } = context;
    const identifiers = Utilities.extractIdentifiersFromText(
        'arXiv:2209.14577v1 [stat.ML]\nDOI: 10.1108/03321640510615607.'
    );
    assert.equal(identifiers.arxivID, '2209.14577v1');
    assert.equal(identifiers.DOI, '10.1108/03321640510615607');

    const attachment = makeAttachment({
        title: 'paper.pdf',
        cacheText: 'Published with doi 10.1234/ABC.DEF and other text.'
    });
    Zotero.Items.byID[attachment.id] = attachment;

    const item = makeItem({ DOI: '' }, 'journalArticle');
    item.attachmentIDs = [attachment.id];
    await ZotMeta.prepareItemForMetadataUpdate(item);
    assert.equal(item.fields.DOI, '10.1234/ABC.DEF');
    assert.equal(item.saved, true);
}

async function testCreateParentItem(context) {
    const { Zotero, ZotMeta } = context;
    const createdItems = [];

    Zotero.Item = function(itemType) {
        const item = makeItem({}, itemType);
        createdItems.push(item);
        return item;
    };

    const originalUpdateItemWithRetry = ZotMeta.updateItemWithRetry;
    ZotMeta.updateItemWithRetry = async () => 0;

    const arxivAttachment = makeAttachment({
        title: '2209.14577v1.pdf',
        filename: '2209.14577v1.pdf',
        cacheText: 'arXiv:2209.14577v1 [stat.ML]'
    });
    const arxivStatus = await ZotMeta.createParentItemForAttachment(arxivAttachment);
    assert.equal(arxivStatus, 0);
    assert.equal(createdItems[0].itemTypeID, 'preprint');
    assert.equal(createdItems[0].fields.archiveID, 'arXiv:2209.14577v1');
    assert.equal(arxivAttachment.parentID, createdItems[0].id);

    const dummyAttachment = makeAttachment({
        title: 'unknown.pdf',
        filename: 'unknown.pdf',
        cacheText: 'No identifiers here'
    });
    const dummyStatus = await ZotMeta.createParentItemForAttachment(dummyAttachment);
    assert.equal(dummyStatus, 0);
    assert.equal(createdItems[1].itemTypeID, 'document');
    assert.equal(createdItems[1].fields.title, 'unknown.pdf');
    assert.deepEqual(createdItems[1].tags, []);

    ZotMeta.updateItemWithRetry = originalUpdateItemWithRetry;
}

function testControlPanel(context) {
    const { Services, Zotero, ZotMeta, Utilities } = context;
    assert.equal(ZotMeta.getConcurrentThreads(), 6);
    assert.equal(ZotMeta.setConcurrentThreads(14), 12);
    assert.equal(Services.prefs.values['extensions.zotmeta.concurrentThreads'], 12);
    assert.equal(ZotMeta.setConcurrentThreads(0), 1);
    assert.equal(Utilities.getConcurrentThreads(), 1);

    const failed = makeItem({ title: 'Failed' }, 'journalArticle');
    failed.tags = ['ZotMeta: Failed'];
    const skipped = makeItem({ title: 'Skipped' }, 'book');
    skipped.tags = ['ZotMeta: Skipped'];
    const regular = makeItem({ title: 'Regular' }, 'journalArticle');
    const attachment = makeAttachment({ title: 'Attachment' });
    Zotero.Items.all = [failed, skipped, regular, attachment];

    const stats = ZotMeta.getLibraryStats();
    assert.equal(stats.totalItems, 3);
    assert.equal(stats.attachments, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.skipped, 1);
    assert.deepEqual(plain(stats.typeDistribution.map(type => type.label)), ['Journal Article', 'Book']);

    const fakeWindow = createFakeWindow();
    ZotMeta.id = 'zotmeta@roadtodream.tech';
    ZotMeta.showControlPanel(fakeWindow);
    assert.deepEqual(Zotero.Utilities.Internal.openedPreferenceIDs, ['zotmeta-prefpane']);
    assert.equal(fakeWindow.openedWindows.length, 0);
}

// A small DOM fixture models the browser XML parser's output without adding a Node dependency.
function xmlNode(tagName, children = [], attributes = {}) {
    if (!Array.isArray(children)) {
        children = [children];
    }
    return {
        tagName,
        children,
        get textContent() {
            return this.children.map(child => typeof child === 'string' ? child : child.textContent).join('');
        },
        getAttribute(name) {
            return attributes[name] || '';
        },
        getElementsByTagName(name) {
            const nodes = [];
            for (const child of this.children) {
                if (typeof child !== 'string') {
                    if (child.tagName === name) {
                        nodes.push(child);
                    }
                    nodes.push(...child.getElementsByTagName(name));
                }
            }
            return nodes;
        }
    };
}

function pubmedDocument() {
    const x = xmlNode;
    return x('document', x('PubmedArticleSet', x('PubmedArticle', [
        x('MedlineCitation', [
            x('PMID', '12345'),
            x('Article', [
                x('Journal', [x('Title', 'Medical Journal'), x('ISOAbbreviation', 'Med J'),
                    x('JournalIssue', [x('Volume', '12'), x('Issue', '3'),
                        x('PubDate', [x('Year', '2024'), x('Month', 'May'), x('Day', '2')])])]),
                x('ArticleTitle', ['Dose ', x('i', 'response'), ': A & B']),
                x('Pagination', x('MedlinePgn', '101-109')),
                x('ELocationID', '10.1234/test', { EIdType: 'doi' }),
                x('AuthorList', [
                    x('Author', [x('LastName', 'Duan'), x('ForeName', 'Jiawei')]),
                    x('Author', [x('LastName', 'Smith'), x('Initials', 'AB')]),
                    x('Author', x('CollectiveName', 'Research Consortium'))
                ]),
                x('Abstract', [x('AbstractText', 'Question & aim', { Label: 'BACKGROUND' }),
                    x('AbstractText', ['Useful ', x('b', 'results')], { Label: 'RESULTS' })]),
                x('Language', 'eng')
            ])
        ]),
        x('PubmedData', [
            x('ArticleIdList', [x('ArticleId', '12345', { IdType: 'pubmed' }),
                x('ArticleId', '10.1234/test', { IdType: 'doi' }),
                x('ArticleId', 'PMC67890', { IdType: 'pmc' })]),
            x('ReferenceList', x('Reference', x('ArticleIdList',
                x('ArticleId', '10.9999/reference', { IdType: 'doi' }))))
        ])
    ])));
}

async function testPubMed(context) {
    const { PubMed, Journal, Book, Utilities, Services } = context;
    const validDocument = pubmedDocument();
    context.DOMParser = class {
        parseFromString(xml) {
            return xml === 'valid-xml' ? validDocument : xmlNode('document', xmlNode('parsererror', 'Invalid XML'));
        }
    };
    const metadata = PubMed.parseMetadata('valid-xml');
    assert.equal(metadata.Title, 'Dose response: A & B');
    assert.equal(metadata.PublishDate, '2024-05-02');
    assert.equal(metadata.Publication, 'Medical Journal');
    assert.equal(metadata.Pages, '101-109');
    assert.equal(metadata.DOI, '10.1234/test');
    assert.equal(metadata.PMID, '12345');
    assert.equal(metadata.PMCID, 'PMC67890');
    assert.equal(metadata.Abstract, 'BACKGROUND: Question & aim\n\nRESULTS: Useful results');
    assert.equal(metadata.Authors[1].firstName, 'AB');
    assert.equal(metadata.Authors[2].fieldMode, 1);
    const articleData = validDocument.getElementsByTagName('PubmedData')[0];
    const originalChildren = articleData.children;
    articleData.children = originalChildren.slice(1);
    assert.equal(PubMed.parseMetadata('valid-xml').DOI, '10.1234/test', 'Reference DOI must not replace a missing article ID list');
    assert.equal(PubMed.parseMetadata('valid-xml').PMCID, '');
    articleData.children = originalChildren;
    assert.equal(PubMed.parseMetadata('invalid-xml'), null);
    assert.equal(PubMed.parseDate(xmlNode('date', xmlNode('MedlineDate', '2024 Spring'))), '2024 Spring');
    assert.equal(PubMed.parseDate(xmlNode('date', xmlNode('Year', '2024'))), '2024');

    const item = makeItem({ DOI: 'https://doi.org/10.1234/test', extra: 'User note\nPMID: 999\nPMCID: PMC111\nOther: Keep' }, 'journalArticle');
    assert.equal(PubMed.applyIdentifiers(item, metadata), true);
    assert.equal(item.fields.extra, 'User note\nPMID: 12345\nPMCID: PMC67890\nOther: Keep');
    assert.equal(PubMed.applyIdentifiers(item, metadata), false);
    assert.equal(PubMed.applyIdentifiers(item, { PMID: '', PMCID: '' }), false);
    const blank = makeItem({});
    PubMed.applyIdentifiers(blank, metadata);
    assert.equal(blank.fields.extra, 'PMID: 12345\nPMCID: PMC67890');
    assert.equal(PubMed.getIdentifiers(makeItem({ url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' })).PMID, '12345');
    assert.equal(PubMed.getIdentifiers(makeItem({ url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC67890/' })).PMCID, 'PMC67890');

    const originalRequest = PubMed.request;
    const calls = [];
    PubMed.request = async (endpoint, parameters) => {
        calls.push({ endpoint, parameters });
        return endpoint === 'esearch.fcgi' ? '{"esearchresult":{"count":"1","idlist":["12345"]}}' : 'valid-xml';
    };
    assert.equal((await PubMed.getMetaData(makeItem({ DOI: 'doi: 10.1234/test' }, 'journalArticle'))).PMID, '12345');
    assert.equal(calls[0].parameters.term, '"10.1234/test"[AID]');
    assert.equal(calls.length, 2);
    calls.length = 0;
    assert.equal((await PubMed.getMetaData(makeItem({ extra: 'PMID: 12345' }, 'journalArticle'))).PMID, '12345');
    assert.equal(calls.length, 1, 'PMID should bypass search');
    calls.length = 0;
    assert.equal((await PubMed.getMetaData(makeItem({ extra: 'PMCID: PMC67890' }, 'journalArticle'))).PMCID, 'PMC67890');
    assert.equal(calls[0].parameters.term, 'PMC67890[PMC]');
    assert.equal(await PubMed.getMetaData(makeItem({ DOI: '10.9999/wrong', extra: 'PMID: 12345' }, 'journalArticle')), null);
    assert.equal(await PubMed.getMetaData(makeItem({ extra: 'PMID: 99999' }, 'journalArticle')), null);
    assert.equal(await PubMed.getMetaData(makeItem({ extra: 'PMCID: PMC99999' }, 'journalArticle')), null);
    assert.equal(await PubMed.getMetaData(makeItem({ title: 'No identifiers' }, 'journalArticle')), null);
    PubMed.request = async () => '{"esearchresult":{"count":"2","idlist":["12345","67890"]}}';
    assert.equal(await PubMed.getMetaData(makeItem({ DOI: '10.1234/test' }, 'journalArticle')), null);
    PubMed.request = async () => '{"esearchresult":{"count":"0","idlist":[]}}';
    assert.equal(await PubMed.getMetaData(makeItem({ DOI: '10.1234/test' }, 'journalArticle')), null);
    PubMed.request = originalRequest;

    const originalFetch = Utilities.fetchWithTimeout;
    const originalPubMed = PubMed.getMetaData;
    Services.prefs.setStringPref(Utilities.journalSourcePref, 'pubmed');
    const urls = [];
    Utilities.fetchWithTimeout = async url => {
        urls.push(url);
        return { ok: true, text: async () => JSON.stringify({ title: ['DOI title'], subtitle: ['Full subtitle'] }) };
    };
    PubMed.getMetaData = async () => metadata;
    assert.equal((await Journal.getMetaData(makeItem({ DOI: '10.1234/test' }, 'journalArticle'))).PMID, '12345');
    assert.equal(urls.length, 0, 'PubMed success must not request DOI metadata');
    PubMed.getMetaData = async () => null;
    assert.equal((await Journal.getMetaData(makeItem({ DOI: '10.1234/test' }, 'journalArticle'))).Title, 'DOI title: Full subtitle');
    PubMed.getMetaData = async () => { throw new Error('Timeout'); };
    assert.equal((await Journal.getMetaData(makeItem({ DOI: '10.1234/test' }, 'journalArticle'))).Title, 'DOI title: Full subtitle');
    Services.prefs.setStringPref(Utilities.journalSourcePref, 'doi');
    let pubmedCalls = 0;
    PubMed.getMetaData = async () => { pubmedCalls++; return metadata; };
    assert.equal((await Journal.getMetaData(makeItem({ DOI: 'https://doi.org/10.1234/test' }, 'journalArticle'))).Title, 'DOI title: Full subtitle');
    assert.equal(pubmedCalls, 0, 'DOI-only mode must not call PubMed');
    assert.equal(urls.at(-1), 'https://doi.org/10.1234/test');
    const doiItem = makeItem({ DOI: '10.1234/test', abstractNote: 'Existing abstract', extra: 'PMID: 12345' }, 'journalArticle');
    await Journal.updateMetadata(doiItem);
    assert.equal(doiItem.fields.abstractNote, 'Existing abstract');
    assert.equal(doiItem.fields.extra, 'PMID: 12345');
    Services.prefs.setStringPref(Utilities.journalSourcePref, 'pubmed');
    PubMed.getMetaData = async () => metadata;
    const updated = makeItem({ extra: 'Keep this note' }, 'journalArticle');
    assert.equal(await Journal.updateMetadata(updated), 0);
    assert.equal(updated.fields.DOI, '10.1234/test');
    assert.equal(updated.fields.extra, 'Keep this note\nPMID: 12345\nPMCID: PMC67890');
    assert.equal(updated.fields.abstractNote, metadata.Abstract);
    assert.equal(updated.saved, true);
    PubMed.getMetaData = originalPubMed;
    Utilities.fetchWithTimeout = async () => ({ ok: true, text: async () => JSON.stringify({
        title: 'Book title', subtitle: 'Book subtitle'
    }) });
    assert.equal((await Book.getMetaData(makeItem({ ISBN: '123' }, 'book'))).Title, 'Book title: Book subtitle');
    Utilities.fetchWithTimeout = originalFetch;

    const starts = [];
    Utilities.fetchWithTimeout = async () => {
        starts.push(Date.now());
        if (starts.length === 1) {
            throw new Error('Network failure');
        }
        return { ok: true, text: async () => 'queued-response' };
    };
    const outcomes = await Promise.allSettled([1, 2, 3].map(id => PubMed.request('efetch.fcgi', { db: 'pubmed', id })));
    assert.equal(outcomes[0].status, 'rejected');
    assert.equal(outcomes[1].value, 'queued-response');
    assert.equal(outcomes[2].value, 'queued-response');
    assert.ok(starts[1] - starts[0] >= 340);
    assert.ok(starts[2] - starts[1] >= 340);
    Utilities.fetchWithTimeout = originalFetch;
    delete Services.prefs.values[Utilities.journalSourcePref];
}

async function testJournalSourceOrder(context) {
    const { Journal, PubMed, Utilities, Services, ZotMeta } = context;
    const originalFetch = Utilities.fetchWithTimeout;
    const originalPubMed = PubMed.getMetaData;
    const originalExtract = Utilities.extractIdentifiersFromItemAttachments;
    const calls = [];
    const item = makeItem({ DOI: '10.1234/test' }, 'journalArticle');
    let doiResponse = { title: 'DOI title', subtitle: ['DOI subtitle'] };
    let doiError = false;
    let doiOK = true;
    let pubmedResult = { Title: 'PubMed title', PMID: '12345' };
    try {
        delete Services.prefs.values[Utilities.journalSourcePref];
        assert.equal(Utilities.getJournalSource(), 'doi-pubmed');
        assert.deepEqual(plain(Utilities.getJournalSourceOrder()), ['doi', 'pubmed']);
        Utilities.fetchWithTimeout = async () => {
            calls.push('doi');
            if (doiError) {
                throw new Error('DOI timeout');
            }
            return { ok: doiOK, text: async () => JSON.stringify(doiResponse) };
        };
        PubMed.getMetaData = async () => { calls.push('pubmed'); return pubmedResult; };
        assert.equal((await Journal.getMetaData(item)).Title, 'DOI title: DOI subtitle');
        assert.deepEqual(calls.splice(0), ['doi'], 'DOI success must not query PubMed');

        doiOK = false;
        assert.equal((await Journal.getMetaData(item)).Title, 'PubMed title');
        assert.deepEqual(calls.splice(0), ['doi', 'pubmed']);
        doiOK = true;
        doiError = true;
        assert.equal((await Journal.getMetaData(item)).Title, 'PubMed title');
        assert.deepEqual(calls.splice(0), ['doi', 'pubmed']);
        doiError = false;
        doiResponse = {};
        assert.equal((await Journal.getMetaData(item)).Title, 'PubMed title');
        assert.deepEqual(calls.splice(0), ['doi', 'pubmed'], 'Empty DOI metadata should trigger fallback');

        const pmidOnly = makeItem({ extra: 'PMID: 12345' }, 'journalArticle');
        Utilities.extractIdentifiersFromItemAttachments = async () => { throw new Error('Unnecessary PDF lookup'); };
        await ZotMeta.prepareItemForMetadataUpdate(pmidOnly);
        assert.equal((await Journal.getMetaData(pmidOnly)).PMID, '12345');
        assert.deepEqual(calls.splice(0), ['pubmed']);

        Services.prefs.setStringPref(Utilities.journalSourcePref, 'pubmed');
        assert.deepEqual(plain(Utilities.getJournalSourceOrder()), ['pubmed', 'doi']);
        assert.equal((await Journal.getMetaData(item)).Title, 'PubMed title');
        assert.deepEqual(calls.splice(0), ['pubmed']);
        pubmedResult = null;
        doiResponse = { title: 'DOI title' };
        assert.equal((await Journal.getMetaData(item)).Title, 'DOI title');
        assert.deepEqual(calls.splice(0), ['pubmed', 'doi']);

        Services.prefs.setStringPref(Utilities.journalSourcePref, 'doi-pubmed');
        doiOK = false;
        assert.equal(await Journal.getMetaData(item), null);
        assert.deepEqual(calls.splice(0), ['doi', 'pubmed']);
        Services.prefs.setStringPref(Utilities.journalSourcePref, 'doi');
        assert.deepEqual(plain(Utilities.getJournalSourceOrder()), ['doi']);
        assert.equal(await Journal.getMetaData(item), null);
        assert.deepEqual(calls.splice(0), ['doi'], 'DOI-only mode must not use PubMed even on failure');
        assert.equal(await Journal.getMetaData(makeItem({}, 'book')), null);
        assert.deepEqual(calls, []);
        Services.prefs.setStringPref(Utilities.journalSourcePref, 'invalid');
        assert.equal(Utilities.getJournalSource(), 'doi-pubmed');
    } finally {
        Utilities.fetchWithTimeout = originalFetch;
        PubMed.getMetaData = originalPubMed;
        Utilities.extractIdentifiersFromItemAttachments = originalExtract;
        delete Services.prefs.values[Utilities.journalSourcePref];
    }
}

async function testArxivDOIFallback(context) {
    const { Arxiv, ZotMeta, Utilities } = context;
    const originalFetch = Utilities.fetchWithTimeout;
    const originalParser = context.DOMParser;
    const originalInterval = Arxiv.requestInterval;
    const originalDelay = Utilities.delay;
    const originalDate = vm.runInContext('Date', context);
    const calls = [];
    const doiData = {
        DOI: '10.48550/ARXIV.2403.18103',
        title: 'Tutorial on Diffusion Models for Imaging and Vision',
        author: [{ given: 'Stanley H.', family: 'Chan' }],
        issued: { 'date-parts': [[2024]] }, abstract: 'A tutorial on diffusion models.', version: '3'
    };
    let journalRef = 'Example Journal, 7 (2024), 1–9';
    function atomDocument(id) {
        const entry = xmlNode('entry', [
            xmlNode('id', 'http://arxiv.org/abs/' + id),
            xmlNode('title', 'Title from arXiv'),
            xmlNode('published', '2024-03-26T21:01:41Z'),
            xmlNode('summary', 'Abstract from arXiv'),
            xmlNode('arxiv:journal_ref', journalRef),
            xmlNode('author', xmlNode('name', 'Stanley H. Chan'))
        ]);
        entry.getElementsByTagNameNS = () => [];
        return xmlNode('document', xmlNode('feed', entry));
    }
    let atomStatus = 429;
    let atomBody = '2403.18103v3';
    let atomThrows = false;
    let fallbackData = doiData;
    try {
        Arxiv.requestInterval = 0;
        context.DOMParser = class {
            parseFromString(value) {
                return value === 'invalid' ? xmlNode('document', xmlNode('parsererror')) : atomDocument(value);
            }
        };
        Utilities.fetchWithTimeout = async (url, options) => {
            calls.push(url);
            if (url.startsWith('https://export.arxiv.org/')) {
                if (atomThrows) {
                    throw new Error('arXiv timeout');
                }
                return { ok: atomStatus === 200, status: atomStatus, headers: new Headers({ 'Retry-After': '0' }),
                    text: async () => atomBody };
            }
            assert.equal(url, 'https://doi.org/10.48550/arXiv.2403.18103');
            assert.equal(options.headers.get('Accept'), 'application/vnd.citationstyles.csl+json');
            return { ok: true, text: async () => JSON.stringify(fallbackData) };
        };
        const item = makeItem({ DOI: '10.48550/arXiv.2403.18103' }, 'preprint');
        assert.equal(Arxiv.getArxivID(item), '2403.18103');
        assert.equal(ZotMeta.getMetadataUpdater(item), Arxiv);
        await ZotMeta.prepareItemForMetadataUpdate(item);
        assert.equal(item.saved, false, 'A DOI-only arXiv preprint needs no PDF identifier extraction');
        assert.equal(await Arxiv.updateMetadata(item), 0);
        assert.equal(item.fields.title, doiData.title);
        assert.equal(item.fields.abstractNote, doiData.abstract);
        assert.equal(item.fields.date, '2024');
        assert.equal(item.fields.repository, 'arXiv');
        assert.equal(item.fields.archiveID, 'arXiv:2403.18103');
        assert.equal(item.fields.url, 'https://arxiv.org/abs/2403.18103');
        assert.equal(item.creators[0].lastName, 'Chan');
        assert.equal(item.saved, true);
        assert.equal(calls.splice(0).length, 2);
        assert.equal(Arxiv.getArxivIDFromDOI('https://doi.org/10.48550/ARXIV.2403.18103'), '2403.18103');
        assert.equal(Arxiv.getArxivIDFromDOI('doi: 10.48550/arXiv.hep-th/9901001'), 'hep-th/9901001');
        assert.equal(Arxiv.getArxivIDFromDOI('10.9999/arXiv.2403.18103'), null);
        assert.equal(Arxiv.getArxivIDFromDOI('10.48550/arXiv.2403.18103junk'), null);
        assert.equal(Arxiv.getArxivID(makeItem({ url: 'https://doi.org/10.48550/arXiv.2403.18103' }, 'preprint')), '2403.18103');

        atomThrows = true;
        assert.equal((await Arxiv.getMetaData(item)).Title, doiData.title);
        atomThrows = false;
        atomStatus = 200;
        for (const invalid of ['invalid', '2403.99999v1', 'api/errors']) {
            atomBody = invalid;
            assert.equal((await Arxiv.getMetaData(item)).Title, doiData.title);
        }
        atomBody = '2403.18103v3';
        calls.length = 0;
        const native = await Arxiv.getMetaData(item);
        assert.equal(native.Title, 'Title from arXiv');
        assert.equal(native.PublishDate, '2024-03-26');
        assert.equal(calls.length, 1, 'An arXiv success should not fetch DOI metadata');

        const referred = makeItem({ archiveID: 'arXiv:2403.18103', extra: 'My note\nPMID: 123' }, 'preprint');
        for (const ref of [journalRef, journalRef, 'Corrected citation', '']) {
            journalRef = ref;
            assert.equal(await Arxiv.updateMetadata(referred), 0);
            assert.equal(referred.fields.extra, 'My note\nPMID: 123\narXiv journal ref: ' + (ref || 'Corrected citation'));
        }
        assert.equal(referred.fields.title, 'Title from arXiv');
        assert.equal(referred.fields.publicationTitle, undefined);
        assert.equal(referred.saved, true);

        atomStatus = 429;
        const existing = makeItem({ archiveID: 'arXiv:2403.18103', DOI: '10.1234/published', date: '2024-03-26' }, 'preprint');
        assert.equal(await Arxiv.updateMetadata(existing), 0);
        assert.equal(existing.fields.DOI, '10.1234/published', 'Fallback must preserve an existing publication DOI');
        assert.equal(existing.fields.date, '2024-03-26', 'Fallback must not reduce date precision');
        const noDOI = makeItem({ archiveID: 'arXiv:2403.18103' }, 'preprint');
        assert.equal(await Arxiv.updateMetadata(noDOI), 0);
        assert.equal(noDOI.fields.DOI, '10.48550/arXiv.2403.18103');
        fallbackData = { ...doiData, DOI: '10.48550/arXiv.2403.99999' };
        assert.equal(await Arxiv.getMetaData(item), null, 'Reject a mismatched DOI response');
        fallbackData = doiData;

        const pinned = makeItem({ DOI: item.fields.DOI, archiveID: 'arXiv:2403.18103v1', title: 'Pinned title' }, 'preprint');
        calls.length = 0;
        assert.equal(await Arxiv.updateMetadata(pinned), 1);
        assert.equal(pinned.fields.title, 'Pinned title');
        assert.equal(calls.length, 2);
        assert.equal(pinned.saved, false, 'A pinned version must not be overwritten by a different DOI version');
        const pinnedLatest = makeItem({ archiveID: 'arXiv:2403.18103v3' }, 'preprint');
        assert.equal(await Arxiv.updateMetadata(pinnedLatest), 0);
        assert.equal(pinnedLatest.fields.archiveID, 'arXiv:2403.18103v3');
        assert.equal(pinnedLatest.fields.url, 'https://arxiv.org/abs/2403.18103v3');
        fallbackData = { ...doiData, version: undefined };
        assert.equal(await Arxiv.getMetaData(pinnedLatest), null, 'An unknown DOI version must not update a pinned preprint');
        fallbackData = doiData;
        atomStatus = 200;
        atomBody = '2403.18103v3';
        assert.equal(await Arxiv.getMetaData(pinned), null);
        atomBody = '2403.18103v1';
        assert.equal((await Arxiv.getMetaData(pinned)).Title, 'Title from arXiv');

        let now = 10000;
        const starts = [];
        context.Date = class extends Date { static now() { return now; } };
        Utilities.delay = async milliseconds => { now += milliseconds; };
        Arxiv.lastRequestTime = 0;
        Arxiv.requestInterval = 3000;
        Utilities.fetchWithTimeout = async () => {
            starts.push(now);
            if (starts.length === 1) {
                throw new Error('Connection failure');
            }
            return { ok: true, text: async () => 'queued-response' };
        };
        const outcomes = await Promise.allSettled([1, 2, 3].map(() => Arxiv.requestMetadata('2403.18103')));
        assert.deepEqual(starts, [10000, 13000, 16000]);
        assert.equal(outcomes[0].status, 'rejected');
        assert.equal(outcomes[2].value, 'queued-response');
    } finally {
        Utilities.fetchWithTimeout = originalFetch;
        context.DOMParser = originalParser;
        Arxiv.requestInterval = originalInterval;
        Utilities.delay = originalDelay;
        context.Date = originalDate;
        Arxiv.lastRequestTime = 0;
    }
}

async function testBookLookups(context) {
    const { Book, Utilities } = context;
    const originalFetch = Utilities.fetchWithTimeout;
    const originalDelay = Utilities.delay;
    const originalDate = vm.runInContext('Date', context);
    const originalInterval = Book.requestInterval;
    // Relevant fields from the live ISBN/edition responses for the reported failures.
    const editions = {
        '/isbn/9780470666449.json': {
            title: 'Nonlinear finite element analysis of solids and structures',
            isbn_13: ['9780470666449'], authors: [{ key: '/authors/OL2698836A' }],
            publishers: ['Wiley'], publish_places: ['Hoboken, NJ'],
            publish_date: '2012', pagination: 'p. cm.'
        },
        '/isbn/9781119121503.json': {
            title: 'Numerical Methods for Ordinary Differential Equations',
            isbn_13: ['9781119121503'], authors: [{ key: '/authors/OL1188948A' }],
            publishers: ['Wiley & Sons, Incorporated, John', 'Wiley'],
            publish_date: '2016', pagination: '544'
        },
        '/authors/OL2698836A.json': { name: 'René de Borst' },
        '/authors/OL1188948A.json': { name: 'John Charles Butcher' }
    };
    const calls = [];
    try {
        Book.requestInterval = 0;
        Book.authorCache.clear();
        Utilities.fetchWithTimeout = async url => {
            calls.push(url);
            const record = editions[url.replace('https://openlibrary.org', '')];
            return { ok: !!record, status: record ? 200 : 404, text: async () => JSON.stringify(record) };
        };
        const first = makeItem({ ISBN: '978-0-470-66644-9', numPages: '516' }, 'book');
        const second = makeItem({ ISBN: '978-1-119-12150-3' }, 'book');
        assert.deepEqual(await Promise.all([Book.updateMetadata(first), Book.updateMetadata(second)]), [0, 0]);
        assert.equal(first.fields.title, 'Nonlinear finite element analysis of solids and structures');
        assert.equal(first.fields.publisher, 'Wiley');
        assert.equal(first.fields.place, 'Hoboken, NJ');
        assert.equal(first.fields.date, '2012');
        assert.equal(first.fields.numPages, '516', 'Unknown pagination must preserve the existing page count');
        assert.equal(first.creators[0].lastName, 'Borst');
        assert.equal(second.fields.title, 'Numerical Methods for Ordinary Differential Equations');
        assert.equal(second.fields.date, '2016');
        assert.equal(second.fields.numPages, '544');
        assert.equal(second.creators[0].lastName, 'Butcher');
        assert.equal(first.saved && second.saved, true);
        assert.equal(calls.length, 4);
        assert.ok(calls.every(url => !url.includes('/api/books')));

        editions['/isbn/9780470666449.json'].subtitle = 'A practical guide';
        await Book.updateMetadata(first);
        assert.equal(first.fields.title, 'Nonlinear finite element analysis of solids and structures: A practical guide');
        assert.equal(calls.filter(url => url.includes('/authors/OL2698836A')).length, 1, 'Author records should be cached');

        // An unresolved author must not replace the creator list with a partial list.
        editions['/isbn/9780470666449.json'].authors.push({ key: '/authors/OL999999999A' });
        const existingCreators = [{ firstName: 'Existing', lastName: 'Author', creatorType: 'author' }];
        first.creators = existingCreators;
        assert.equal(await Book.updateMetadata(first), 0);
        assert.equal(first.creators, existingCreators);
        assert.equal(Book.authorCache.has('/authors/OL999999999A'), false);
        editions['/authors/OL999999999A.json'] = { name: 'Recovered Author' };
        assert.equal((await Book.getAuthor({ key: '/authors/OL999999999A' })).name, 'Recovered Author');

        const missing = makeItem({ ISBN: '9780000000000', title: 'Keep title' }, 'book');
        assert.equal(await Book.updateMetadata(missing), 1);
        assert.equal(missing.fields.title, 'Keep title');
        assert.equal(missing.saved, false);

        // Use a virtual clock to check batch pacing and recovery without real sleeps.
        let now = 10000;
        const starts = [];
        context.Date = class extends Date { static now() { return now; } };
        Utilities.delay = async milliseconds => { now += milliseconds; };
        Book.lastRequestTime = 0;
        Book.requestInterval = 1000;
        Utilities.fetchWithTimeout = async () => {
            starts.push(now);
            if (starts.length === 1) {
                throw new Error('Network failure');
            }
            return { ok: true, text: async () => starts.length === 2 ? 'invalid-json' : '{"title":"Recovered"}' };
        };
        const results = await Promise.all([1, 2, 3].map(id => Book.request('/isbn/' + id + '.json')));
        assert.deepEqual(starts, [10000, 11000, 12000]);
        assert.equal(results[0], null);
        assert.equal(results[1], null);
        assert.equal(results[2].title, 'Recovered');
    } finally {
        Utilities.fetchWithTimeout = originalFetch;
        Utilities.delay = originalDelay;
        context.Date = originalDate;
        Book.requestInterval = originalInterval;
        Book.lastRequestTime = 0;
        Book.authorCache.clear();
    }
}

function testSubtitles(Journal, Utilities) {
    assert.equal(Journal.generateTitle({ title: ['Main title: A &amp; B'], subtitle: ['A & B'] }), 'Main title: A & B');
    assert.equal(Journal.generateTitle({ title: ['Main title: SUBTITLE.'], subtitle: ['subtitle'] }), 'Main title: SUBTITLE.');
    assert.equal(Journal.generateTitle({ title: ['Main title:'], subtitle: [' Subtitle\ntext '] }), 'Main title: Subtitle text');
    assert.equal(Journal.generateTitle({ subtitle: ['Subtitle only'] }), 'Subtitle only');
    assert.equal(Journal.generateTitle({ title: ['Short study title'], subtitle: ['study'] }), 'Short study title: study');
    assert.equal(Utilities.combineTitleAndSubtitle('Main title', ''), 'Main title');
    const item = makeItem({ title: 'Keep title', abstractNote: 'Keep abstract' });
    assert.equal(Utilities.applyMetadata(item, { Title: null }, { Title: 'title', Abstract: 'abstractNote' }), false);
    assert.equal(item.fields.title, 'Keep title');
    assert.equal(item.fields.abstractNote, 'Keep abstract');
}

async function testPreparationFailure(context) {
    const { ZotMeta, Zotero } = context;
    const originalPrepare = ZotMeta.prepareItemForMetadataUpdate;
    const originalRecord = ZotMeta.recordUpdateResult;
    const originalDebug = Zotero.debug;
    const logged = [];
    const item = makeItem({ title: 'Preparation failure' }, 'journalArticle');
    const results = [];
    Zotero.debug = line => logged.push(line);
    ZotMeta.prepareItemForMetadataUpdate = async () => { throw new Error('PDF cache failure'); };
    ZotMeta.recordUpdateResult = async (batch, item, status) => results.push(status);
    await ZotMeta.processUpdateTask({ batch: {}, item });
    assert.deepEqual(results, [1]);
    assert.deepEqual(readFailureLogs(logged), [
        { itemID: item.id, title: 'Preparation failure', reason: 'Error: PDF cache failure' }
    ]);
    ZotMeta.prepareItemForMetadataUpdate = originalPrepare;
    ZotMeta.recordUpdateResult = originalRecord;
    Zotero.debug = originalDebug;
}

function readFailureLogs(lines) {
    const prefix = 'ZotMeta: Failed to update item metadata: ';
    return lines.filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
}

async function testRateLimitRetries(context) {
    const { ZotMeta, Zotero, Journal, Utilities } = context;
    const originalPubMedTime = context.PubMed.lastRequestTime;
    const originalDate = vm.runInContext('Date', context);
    const originalFetch = Utilities.fetchWithTimeout;
    const originalDelay = Utilities.delay;
    const originalDebug = Zotero.debug;
    const log = [], waits = [], starts = [];
    let now = Date.UTC(2026, 0, 1);
    const item = makeItem({ DOI: '10.1111/example', title: 'Example' }, 'journalArticle');
    const limited = header => ({ status: 429, headers: new Headers(header ? { 'Retry-After': header } : {}) });
    const ok = value => ({ ok: true, text: async () => JSON.stringify(value) });
    const batch = { id: 12 };
    try {
        context.Date = class extends Date { static now() { return now; } };
        context.PubMed.lastRequestTime = 0;
        Utilities.sourceCooldowns.clear();
        Utilities.delay = async ms => { waits.push(ms); now += ms; };
        Zotero.debug = line => log.push(line);
        Utilities.fetchWithTimeout = async url => {
            if (url.startsWith('https://doi.org/')) {
                starts.push(now);
                return starts.length === 1 ? limited('3') : ok({ title: 'Found after cooldown' });
            }
            return ok({ esearchresult: { count: '0', idlist: [] } });
        };
        assert.equal(await ZotMeta.updateItemWithRetry(Journal, item, item.fields.title, batch), 0);
        assert.equal(starts[1] - starts[0], 3000);
        assert.equal(item.fields.title, 'Found after cooldown');
        assert.deepEqual(readFailureLogs(log), []);

        let doiCalls = 0;
        const fallbackCalls = [];
        Utilities.fetchWithTimeout = async url => {
            if (url.startsWith('https://doi.org/')) {
                doiCalls++;
                return limited(new Date(now + 60000).toUTCString());
            }
            fallbackCalls.push(url);
            return ok({ esearchresult: { count: '0', idlist: [] } });
        };
        waits.length = 0;
        assert.equal(await ZotMeta.updateItemWithRetry(Journal, item, item.fields.title, batch), 1);
        assert.equal(await ZotMeta.updateItemWithRetry(Journal, item, item.fields.title, batch), 1);
        assert.equal(doiCalls, 1, 'Other workers honor the shared Retry-After date');
        assert.equal(fallbackCalls.length, 2, 'A cooling DOI host must not block PubMed');
        assert.ok(waits.every(ms => ms <= 350), 'Only normal PubMed pacing, no long retry timer');
        for (const failure of readFailureLogs(log)) {
            assert.equal(failure.batchID, 12);
            assert.match(failure.reason, /HTTP 429.*retry later.*PubMed: search returned 0 matches/);
        }
        assert.equal(readFailureLogs(log).length, 2);

        let finishEarlierRequest;
        let raceCalls = 0;
        Utilities.fetchWithTimeout = async () => {
            if (++raceCalls === 1) return new Promise(resolve => { finishEarlierRequest = resolve; });
            return limited('15');
        };
        const earlier = Utilities.requestMetadataText('race', 'https://race.example/a', {});
        await Utilities.requestMetadataText('race', 'https://race.example/b', {});
        finishEarlierRequest(ok({ title: 'Already in flight' }));
        await earlier;
        assert.equal(await Utilities.requestMetadataText('race', 'https://race.example/c', {}), null);
        assert.equal(raceCalls, 2, 'An in-flight success must not cancel a newer cooldown');

        let rawRequests = 0;
        Utilities.fetchWithTimeout = async () => { rawRequests++; return limited(); };
        for (const backoff of [2000, 4000, 8000, 16000, 30000, 30000]) {
            const previous = rawRequests;
            await Utilities.requestMetadataText('test', 'https://example.org/a', {});
            now += backoff - 1;
            await Utilities.requestMetadataText('test', 'https://example.org/b', {});
            assert.equal(rawRequests, previous + 1, 'No early retry on the same host');
            now++;
        }
        waits.length = 0;
        const missing = makeItem({ title: 'No identifiers' }, 'journalArticle');
        const callsBeforeMissing = rawRequests;
        assert.equal(await ZotMeta.updateItemWithRetry(Journal, missing), 1);
        assert.equal(rawRequests, callsBeforeMissing);
        assert.deepEqual(waits, [], 'Missing identifiers do not trigger a retry');
        assert.match(readFailureLogs(log).at(-1).reason, /missing DOI.*missing DOI, PMID and PMCID/);
    } finally {
        Utilities.sourceCooldowns.clear();
        Utilities.fetchWithTimeout = originalFetch;
        Utilities.delay = originalDelay;
        Zotero.debug = originalDebug;
        context.Date = originalDate;
        context.PubMed.lastRequestTime = originalPubMedTime;
    }
    console.log('Rate-limit retries passed: seconds/date, bounded backoff, shared cooldown, fallback and missing IDs');
}

async function testFailureDiagnostics(context) {
    const { ZotMeta, Zotero, Utilities, PubMed } = context;
    const originalFetch = Utilities.fetchWithTimeout;
    const originalDelay = Utilities.delay;
    const originalDebug = Zotero.debug;
    const originalItem = Zotero.Item;
    const log = [];
    const missing = makeItem({ title: 'Missing ISBN' }, 'book');
    const journal = makeItem({ DOI: '10.1111/unmatched', title: 'A long title: ' + '文'.repeat(80) }, 'journalArticle');
    const pinned = makeItem({ archiveID: 'arXiv:2403.18103v1', title: 'Versioned preprint' }, 'preprint');
    const preprint = makeItem({ archiveID: 'arXiv:2403.18103', title: 'Unversioned preprint' }, 'preprint');
    const write = makeItem({ ISBN: '123', title: 'Original "title"\nsecond line' }, 'book');
    const retry = makeItem({ ISBN: '456', title: 'Recovered on retry' }, 'book');
    const skipped = makeItem({ title: 'Unsupported' }, 'conferencePaper');
    let retryRequests = 0;
    write.saveTx = async () => { throw new Error('Database is read-only'); };
    try {
        Utilities.delay = async () => {};
        Zotero.debug = line => log.push(line);
        const ok = data => ({ ok: true, text: async () => JSON.stringify(data) });
        Utilities.fetchWithTimeout = async url => {
            if (url.includes('/isbn/456') && ++retryRequests === 1) return { ok: false, status: 503 };
            if (url.startsWith('https://openlibrary.org/')) return ok({ title: 'Fetched book title' });
            if (url.startsWith(PubMed.baseURL)) return ok({ esearchresult: { count: '0', idlist: [] } });
            if (url.startsWith('https://export.arxiv.org/')) return { ok: false, status: 429 };
            if (url.includes('10.48550/arXiv.2403.18103')) {
                return ok({ DOI: '10.48550/arXiv.2403.18103', title: 'Another version', version: '3' });
            }
            assert.match(url, /10\.1111\/unmatched/);
            return { ok: false, status: 404 };
        };
        ZotMeta.enqueueUpdateBatch([missing, journal, pinned, write, retry, skipped, preprint], createFakeWindow());
        await waitForQueueToFinish(ZotMeta);
        const failures = readFailureLogs(log);
        assert.equal(failures.length, 4, 'Exactly one final failure per item, irrespective of retries or fallback');
        const batchID = ZotMeta.updateBatchCounter;
        assert.ok(failures.every(failure => failure.batchID === batchID));
        assert.ok(log.includes('ZotMeta: Preprint saved: ' + JSON.stringify({ batchID, itemID: preprint.id })));
        assert.ok(log.includes('ZotMeta: Batch completed: ' + JSON.stringify({
            batchID, total: 7, updated: 2, failed: 4, skipped: 1
        })));
        const byID = new Map(failures.map(failure => [failure.itemID, failure]));
        assert.match(byID.get(missing.id).reason, /missing ISBN/);
        assert.equal(byID.get(journal.id).title, journal.fields.title);
        assert.match(byID.get(journal.id).reason, /DOI: HTTP 404/);
        assert.match(byID.get(journal.id).reason, /PubMed: search returned 0 matches/);
        assert.match(byID.get(pinned.id).reason, /arXiv: HTTP 429/);
        assert.match(byID.get(pinned.id).reason, /requested version v1/);
        assert.equal(byID.get(write.id).title, 'Original "title"\nsecond line');
        assert.match(byID.get(write.id).reason, /Database is read-only/);
        assert.equal(retry.saved, true);
        assert.equal(retryRequests, 2);
        assert.deepEqual(skipped.tags, ['ZotMeta: Skipped']);
        assert.ok(log.every(line => !line.includes('\n')), 'Each failure is one searchable debug entry');

        log.length = 0;
        Zotero.Item = function (type) { return makeItem({}, type); };
        const attachment = makeAttachment({ title: 'Parent test.pdf', cacheText: 'DOI: 10.1111/unmatched' });
        assert.equal(await ZotMeta.createParentItemForAttachment(attachment), 1);
        const [parent] = readFailureLogs(log);
        assert.equal(parent.itemID, attachment.parentID);
        assert.equal(parent.title, 'Parent test.pdf');
        assert.match(parent.reason, /HTTP 404/);
    } finally {
        Zotero.Item = originalItem;
        Zotero.debug = originalDebug;
        Utilities.fetchWithTimeout = originalFetch;
        Utilities.delay = originalDelay;
    }
    console.log('Update diagnostics passed: concurrent failures, retry, skip, failed save and parent item');
}

function testSourceSettings(context) {
    const elements = {};
    for (const id of ['zotmeta-pref-concurrent-range', 'zotmeta-pref-concurrent-number',
        'zotmeta-pref-save', 'zotmeta-pref-journal-source', 'zotmeta-pref-tag-failed']) {
        elements[id] = { listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
    }
    context.document = { getElementById: id => elements[id] || null };
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'src/preferences.js'), 'utf8'), context);
    const preferences = context.ZotMetaPreferences;
    preferences.renderSettings();
    assert.equal(elements['zotmeta-pref-journal-source'].value, 'doi-pubmed');
    assert.equal(elements['zotmeta-pref-tag-failed'].checked, false);
    elements['zotmeta-pref-concurrent-number'].value = 4;
    for (const source of ['doi', 'pubmed', 'doi-pubmed']) {
        elements['zotmeta-pref-journal-source'].value = source;
        elements['zotmeta-pref-save'].listeners.click();
        assert.equal(context.Utilities.getJournalSource(), source);
        elements['zotmeta-pref-journal-source'].value = '';
        preferences.renderSettings();
        assert.equal(elements['zotmeta-pref-journal-source'].value, source, 'Saved lookup order must survive reopening');
    }
    assert.equal(context.Utilities.getConcurrentThreads(), 4);
    for (const enabled of [true, false]) {
        elements['zotmeta-pref-tag-failed'].checked = enabled;
        elements['zotmeta-pref-save'].listeners.click();
        assert.equal(context.Utilities.shouldTagFailedItems(), enabled);
        elements['zotmeta-pref-tag-failed'].checked = !enabled;
        preferences.renderSettings();
        assert.equal(elements['zotmeta-pref-tag-failed'].checked, enabled, 'Saved tagging preference must survive reopening');
    }
    context.Services.prefs.setIntPref(context.Utilities.concurrentThreadsPref, 6);
    delete context.Services.prefs.values[context.Utilities.journalSourcePref];
    delete context.Services.prefs.values[context.Utilities.tagFailedItemsPref];
}

async function testInterfaceLocalization() {
    const context = loadScripts(['src/chrome/content/utilities.js', 'src/chrome/content/zotmeta.js']);
    context.document = { getElementById: () => null };
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'src/preferences.js'), 'utf8'), context);
    const { ZotMetaL10n: l10n, ZotMetaPreferences: prefs, Zotero, Utilities, ZotMeta } = context;
    for (const [locale, chinese] of [['en-US', false], ['en-GB', false], ['zh-CN', true],
        ['zh-Hans', true], ['fr-FR', false], ['zh-TW', false], ['zh-HK', false]]) {
        Zotero.locale = locale;
        assert.equal(l10n.locale, chinese ? 'zh-CN' : 'en-US');
        assert.equal(l10n.t('update-metadata.label'), chinese ? '更新元数据' : 'Update Metadata');
        assert.equal(l10n.itemType('journalArticle'), chinese ? '期刊文章' : 'Journal Article');
        assert.equal(l10n.itemType('does-not-exist'), chinese ? '未知条目类型' : 'Unknown item type');
        assert.equal(l10n.number(12345), new Intl.NumberFormat(l10n.formatLocale).format(12345));
        assert.equal(l10n.date(new Date(2026, 2, 4)), new Intl.DateTimeFormat(l10n.formatLocale, {
            year: 'numeric', month: 'long', day: 'numeric'
        }).format(new Date(2026, 2, 4)));
        assert.equal(Utilities.formatBatchProgress(4, 10, 2, 1, 1), chinese
            ? '已检查 4/10 — 已更新 2 个，失败 1 个，跳过 1 个'
            : '4/10 checked - 2 updated, 1 failed, 1 skipped');
        const summary = Utilities.formatBatchSummary(2, 1, 1, ['Original Title — DOI 10.1234/ABC']);
        assert.ok(summary.includes('Original Title — DOI 10.1234/ABC'), 'Bibliographic data must stay verbatim');
        assert.equal(Utilities.getBatchSummaryTitle(1, 0, 0), chinese ? '元数据已更新' : 'Metadata updated');
        assert.equal(Utilities.getBatchSummaryTitle(0, 1, 0), chinese ? '元数据更新失败' : 'Metadata update failed');
        assert.equal(Utilities.getBatchSummaryTitle(0, 0, 2), chinese ? '未更新元数据' : 'No metadata updated');
        const item = makeItem({ title: 'Original Title', DOI: '10.1234/ABC', dateAdded: '2024-02-29 12:00:00' }, 'journalArticle');
        item.tags = ['ZotMeta: Failed', 'ZotMeta: Skipped'];
        Zotero.Items.all = [item, makeAttachment({ title: 'Original PDF.pdf' })];
        prefs.activitySelectedYear = 2024;
        const stats = await prefs.getLibraryStats();
        assert.equal(stats.totalItems, 1);
        assert.equal(stats.attachments, 1);
        assert.equal(stats.failed, 1);
        assert.equal(stats.skipped, 1);
        assert.equal(stats.typeDistribution[0].label, chinese ? '期刊文章' : 'Journal Article');
        assert.equal(stats.activity.days.filter(day => day.inRange).length, 366);
        assert.equal(stats.activity.days.find(day => day.key === '2024-02-29').count, 1);
        assert.equal(stats.activity.total, 1);
        assert.equal(item.getField('title'), 'Original Title');
        assert.equal(item.getField('DOI'), '10.1234/ABC');
        const untitled = makeAttachment();
        untitled.attachmentFilename = '';
        assert.equal(ZotMeta.getAttachmentTitle(untitled), 'Untitled attachment', 'Stored placeholder must remain stable');

        const fake = createFakeWindow();
        context.document = fake.document;
        for (const id of ['zotmeta-pref-activity-grid', 'zotmeta-pref-activity-summary', 'zotmeta-pref-activity-year',
            'zotmeta-pref-activity-previous', 'zotmeta-pref-activity-next', 'zotmeta-pref-activity-legend']) {
            const element = fake.document.createElementNS('', 'div');
            element.id = id;
            fake.document.body.appendChild(element);
        }
        prefs.renderActivity(stats.activity);
        const grid = fake.document.getElementById('zotmeta-pref-activity-grid');
        const leapDay = grid.children.find(cell => cell.attributes.title === l10n.t('activity-tip', {
            date: l10n.date(new Date(2024, 1, 29)), count: l10n.number(1)
        }));
        assert.ok(leapDay, 'Localized hover detail must retain the date and count');
        const legend = fake.document.getElementById('zotmeta-pref-activity-legend');
        assert.deepEqual(legend.children.slice(1, 6).map(cell => cell.className),
            [0, 1, 2, 3, 4].map(level => 'zotmeta-pref-activity-cell level-' + level));
        fake.document.getElementById('zotmeta-pref-activity-previous').listeners.click();
        assert.equal(prefs.activitySelectedYear, 2023);
        fake.document.getElementById('zotmeta-pref-activity-next').listeners.click();
        assert.equal(prefs.activitySelectedYear, 2024);

        // SQL statistics must use the same official labels as the item fallback.
        Zotero.DB = {
            valueQueryAsync: async () => 1,
            queryAsync: async () => [{ label: 'journalArticle', count: 1 }]
        };
        assert.equal((await prefs.getItemStatsFromDB()).typeDistribution[0].label,
            chinese ? '期刊文章' : 'Journal Article');
        delete Zotero.DB;
    }
    for (let max = 0; max <= 20; max++) {
        assert.equal(prefs.getActivityLevel(0, max), 0);
        for (let count = 1; count <= max; count++) {
            assert.ok(prefs.getActivityLevel(count, max) > 0);
        }
    }
    const source = fs.readFileSync(path.join(repoRoot, 'src/preferences.xhtml'), 'utf8');
    const ids = [...source.matchAll(/data-l10n-id="([^"]+)"/g)].map(match => match[1]);
    const locales = ['en-US', 'zh-CN'].map(locale => fs.readFileSync(
        path.join(repoRoot, 'src/locale', locale, 'zotmeta.ftl'), 'utf8'));
    const keys = locales.map(text => [...text.matchAll(/^([\w-]+)\s*=/gm)].map(match => match[1]).sort());
    assert.deepEqual(keys[0], keys[1], 'Fluent locales must have matching keys');
    for (const id of ids) assert.ok(keys[0].includes(id), 'Missing XHTML Fluent string: ' + id);
    const propertyKeys = ['en-US', 'zh-CN'].map(locale => fs.readFileSync(
        path.join(repoRoot, 'src/chrome/locale', locale, 'zotmeta.properties'), 'utf8')
        .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')[0].trim()).sort());
    assert.deepEqual(propertyKeys[0], propertyKeys[1], 'Dynamic locales must have matching keys');
    // Guard against returning to OS-dependent theme detection.
    const theme = fs.readFileSync(path.join(repoRoot, 'src/theme.css'), 'utf8');
    assert.ok(theme.includes('var(--color-background, Canvas)') && theme.includes('var(--fill-primary, CanvasText)'));
    assert.ok(!theme.includes('prefers-color-scheme'), 'Actual Zotero theme variables must drive the palette');
    console.log('Interface regression passed: en-US, en-GB, zh-CN, zh-Hans, fr-FR, zh-TW, zh-HK; SQL/fallback stats, leap-year activity, navigation, UI-only translation, resource parity');
}

async function testPrivateBuildUpdates() {
    const context = loadScripts([]);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'src/bootstrap.js'), 'utf8'), context);
    // An ordinary build must not import AddonManager or change any update setting.
    await context.configurePrivateBuildUpdates('zotmeta@roadtodream.tech');
    const calls = [];
    const addon = { applyBackgroundUpdates: 1 };
    context.ChromeUtils = { importESModule(uri) {
        assert.equal(uri, 'resource://gre/modules/AddonManager.sys.mjs');
        return { AddonManager: {
            AUTOUPDATE_DISABLE: 0,
            async getAddonByID(id) {
                calls.push(id);
                return addon;
            }
        } };
    } };
    context.Services.prefs.values['extensions.zotmeta.privateBuild'] = true;
    await context.configurePrivateBuildUpdates('zotmeta@roadtodream.tech');
    assert.deepEqual(calls, ['zotmeta@roadtodream.tech']);
    assert.equal(addon.applyBackgroundUpdates, 0);
    assert.deepEqual(Object.keys(context.Services.prefs.values), ['extensions.zotmeta.privateBuild'],
        'Private builds must not disable global add-on updates');
    console.log('Private build update policy passed: only ZotMeta background updates disabled; ordinary builds unchanged');
}

async function main() {
    const context = loadScripts([
        'src/chrome/content/utilities.js',
        'src/chrome/content/threadpool.js',
        'src/chrome/content/pubmed.js',
        'src/chrome/content/journal.js',
        'src/chrome/content/book.js',
        'src/chrome/content/arxiv.js',
        'src/chrome/content/zotmeta.js'
    ]);

    const { Utilities, ThreadPool, Journal, Book, Arxiv, ZotMeta } = context;

    testSubtitles(Journal, Utilities);
    await testPubMed(context);
    await testJournalSourceOrder(context);
    await testArxivDOIFallback(context);
    await testBookLookups(context);
    await testPreparationFailure(context);
    await testRateLimitRetries(context);
    await testFailureDiagnostics(context);
    testSourceSettings(context);

    assert.equal(Utilities.decodeHTMLEntities('A &amp; B &#x1f;'), 'A & B \u001f');
    assert.equal(Utilities.safeGetFromJson({ a: [{ b: 3 }] }, ['a', '0', 'b']), 3);
    assert.equal(Utilities.normalizeWhitespace('  one\n two\tthree  '), 'one two three');
    assert.equal(Utilities.pluralize(1, 'item'), '1 item');
    assert.equal(Utilities.pluralize(2, 'item'), '2 items');
    assert.equal(
        Utilities.formatBatchProgress(4, 10, 2, 1, 1),
        '4/10 checked - 2 updated, 1 failed, 1 skipped'
    );
    assert.equal(
        Utilities.formatBatchSummary(2, 1, 1, ['A very long failed item title that should be clipped before it fills the whole popup']),
        '2 items updated, 1 item failed, 1 item skipped. Failed: A very long failed item title that should be clipped befo...'
    );
    assert.equal(Utilities.getBatchSummaryTitle(2, 0, 1), 'Metadata updated with skips');
    assert.equal(Utilities.getBatchSummaryTitle(0, 0, 3), 'No metadata updated');
    testModernProgressPanel(Utilities);

    const applyItem = makeItem({});
    assert.equal(Utilities.applyMetadata(applyItem, {
        Title: 'New title',
        Authors: [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }]
    }, {
        Title: 'title',
        Authors: 'creators'
    }), true);
    assert.equal(applyItem.fields.title, 'New title');
    assert.equal(applyItem.creators[0].lastName, 'Lovelace');

    assert.deepEqual(plain(Book.generateAuthor({ name: 'Lovelace, Ada' })), {
        firstName: 'Ada',
        lastName: 'Lovelace',
        creatorType: 'author'
    });
    assert.deepEqual(plain(Book.generateAuthors([{ missing: true }, { name: 'Grace Hopper' }])), [{
        firstName: 'Grace',
        lastName: 'Hopper',
        creatorType: 'author'
    }]);

    assert.equal(Journal.generateTitle({
        title: ['Main title'],
        subtitle: ['Subtitle']
    }), 'Main title: Subtitle');
    assert.equal(Journal.getPublicationDate({
        issued: { 'date-parts': [[2024, 5, 2]] }
    }), '2024-5-2');
    assert.deepEqual(plain(Journal.generateAuthors([{ literal: 'Research Consortium' }])), [{
        firstName: '',
        lastName: 'Research Consortium',
        creatorType: 'author'
    }]);

    assert.equal(Arxiv.getArxivID(makeItem({ archiveID: 'arXiv:2401.12345v2' })), '2401.12345v2');
    assert.equal(Arxiv.getArxivID(makeItem({ url: 'https://arxiv.org/pdf/hep-th/9901001.pdf' })), 'hep-th/9901001');
    assert.equal(Arxiv.getArxivID(makeItem({ extra: 'arXiv ID: 2310.00001' })), '2310.00001');
    assert.equal(ZotMeta.isArxivPreprint(makeItem({ url: 'https://arxiv.org/abs/2401.12345' })), true);

    await testThreadPoolConcurrency(ThreadPool);
    await testSharedUpdatePopup(context);
    await testUpdateRetry(context);
    await testStatusTags(context);
    await testIdentifierExtraction(context);
    await testCreateParentItem(context);
    testControlPanel(context);
    await testInterfaceLocalization();
    await testPrivateBuildUpdates();

    console.log('All tests passed');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
