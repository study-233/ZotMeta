PubMed = {
    baseURL: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/',
    requestQueue: Promise.resolve(),
    lastRequestTime: 0,
    requestInterval: 350,

    normalizeDOI(value) {
        return (value || '').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i, '').trim();
    },

    getIdentifiers(item) {
        var extra = item.getField('extra') || '';
        var url = item.getField('url') || '';
        var pmid = extra.match(/^\s*PMID\s*:\s*(\d+)\s*$/im) ||
            url.match(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)(?:[/?#]|$)/i);
        var pmcid = extra.match(/^\s*PMCID\s*:\s*(PMC\d+)\s*$/im) ||
            url.match(/^https?:\/\/(?:pmc|www)\.ncbi\.nlm\.nih\.gov\/(?:pmc\/)?articles\/(PMC\d+)(?:[/?#]|$)/i);
        return {
            DOI: this.normalizeDOI(item.getField('DOI')),
            PMID: pmid ? pmid[1] : '',
            PMCID: pmcid ? pmcid[1].toUpperCase() : ''
        };
    },

    request(endpoint, parameters, reasons) {
        var query = Object.keys(parameters).map(key => encodeURIComponent(key) + '=' +
            encodeURIComponent(parameters[key])).join('&');
        var url = this.baseURL + endpoint + '?tool=ZotMeta&' + query;
        // One queue is shared by all batch workers: at most three request starts per second.
        var request = this.requestQueue.then(async () => {
            var wait = this.requestInterval - (Date.now() - this.lastRequestTime);
            if (wait > 0) {
                await Utilities.delay(wait);
            }
            this.lastRequestTime = Date.now();
            return Utilities.requestMetadataText('PubMed ' + endpoint, url, { method: 'GET' }, reasons);
        });
        this.requestQueue = request.catch(() => {});
        return request;
    },

    async getMetaData(item, reasons) {
        var identifiers = this.getIdentifiers(item);
        var pmid = identifiers.PMID;
        if (!pmid) {
            var term;
            if (identifiers.DOI) {
                term = '"' + identifiers.DOI.replace(/"/g, '') + '"[AID]';
            } else if (identifiers.PMCID) {
                term = identifiers.PMCID + '[PMC]';
            } else {
                return Utilities.lookupFailure(reasons, 'PubMed: missing DOI, PMID and PMCID', false);
            }
            var result = Utilities.parseJsonOrNull(await this.request('esearch.fcgi', {
                db: 'pubmed', term, retmode: 'json', retmax: 2
            }, reasons), 'PubMed search', reasons);
            if (!result) return null;
            var search = result.esearchresult;
            // Do not overwrite metadata using an ambiguous identifier match.
            if (search && search.count != null && Number(search.count) !== 1) {
                return Utilities.lookupFailure(reasons, 'PubMed: search returned ' + search.count + ' matches (expected one)', false);
            }
            if (!search || Number(search.count) !== 1 || !search.idlist || search.idlist.length !== 1 ||
                !/^\d+$/.test(search.idlist[0])) {
                return Utilities.lookupFailure(reasons, 'PubMed: invalid search result or PMID');
            }
            pmid = search.idlist[0];
        }
        var metadata = this.parseMetadata(await this.request('efetch.fcgi', {
            db: 'pubmed', id: pmid, retmode: 'xml'
        }, reasons), reasons);
        if (!metadata) return null;
        if (metadata.PMID !== pmid) {
            return Utilities.lookupFailure(reasons, 'PubMed: returned PMID does not match item');
        }
        if (identifiers.DOI && (!metadata.DOI ||
            this.normalizeDOI(metadata.DOI).toLowerCase() !== identifiers.DOI.toLowerCase())) {
            return Utilities.lookupFailure(reasons, 'PubMed: returned DOI does not match item');
        }
        if (identifiers.PMCID && metadata.PMCID !== identifiers.PMCID) {
            return Utilities.lookupFailure(reasons, 'PubMed: returned PMCID does not match item');
        }
        return metadata;
    },

    first(parent, tagName) {
        return parent ? parent.getElementsByTagName(tagName)[0] || null : null;
    },

    firstChild(parent, tagName) {
        for (var child of parent ? parent.children : []) {
            if (child.tagName === tagName) {
                return child;
            }
        }
        return null;
    },

    text(parent, tagName) {
        var node = this.first(parent, tagName);
        return node ? Utilities.normalizeWhitespace(node.textContent) : '';
    },

    parseDate(date) {
        var year = this.text(date, 'Year');
        if (!year) {
            return this.text(date, 'MedlineDate');
        }
        var month = this.text(date, 'Month');
        var day = this.text(date, 'Day');
        if (/^[a-z]{3}$/i.test(month)) {
            var index = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
                .indexOf(month.toLowerCase());
            month = index < 0 ? month : String(index + 1);
        }
        if (!month) {
            return year;
        }
        if (!/^\d{1,2}$/.test(month)) {
            return year + ' ' + month + (day ? ' ' + day : '');
        }
        return year + '-' + month.padStart(2, '0') + (day ? '-' + day.padStart(2, '0') : '');
    },

    parseMetadata(xml, reasons) {
        if (!xml) {
            return null;
        }
        var document = new DOMParser().parseFromString(xml, 'application/xml');
        if (document.getElementsByTagName('parsererror').length) {
            return Utilities.lookupFailure(reasons, 'PubMed: invalid XML response');
        }
        var records = document.getElementsByTagName('PubmedArticle');
        if (records.length !== 1) {
            return Utilities.lookupFailure(reasons, 'PubMed: response contained ' + records.length + ' articles (expected one)');
        }
        var record = records[0];
        var citation = this.first(record, 'MedlineCitation');
        var article = this.first(citation, 'Article');
        var title = this.text(article, 'ArticleTitle');
        var pmid = this.text(citation, 'PMID');
        if (!title || !/^\d+$/.test(pmid)) {
            return Utilities.lookupFailure(reasons, 'PubMed: record missing title or valid PMID');
        }
        var journal = this.first(article, 'Journal');
        var issue = this.first(journal, 'JournalIssue');
        var authors = [];
        var authorList = this.first(article, 'AuthorList');
        for (var author of authorList ? authorList.getElementsByTagName('Author') : []) {
            var collective = this.text(author, 'CollectiveName');
            var lastName = this.text(author, 'LastName');
            if (collective) {
                authors.push({ lastName: collective, fieldMode: 1, creatorType: 'author' });
            } else if (lastName) {
                authors.push({ firstName: this.text(author, 'ForeName') || this.text(author, 'Initials'),
                    lastName, creatorType: 'author' });
            }
        }
        var abstracts = [];
        var abstract = this.first(article, 'Abstract');
        for (var part of abstract ? abstract.getElementsByTagName('AbstractText') : []) {
            var content = Utilities.normalizeWhitespace(part.textContent);
            var label = part.getAttribute('Label');
            if (content) {
                abstracts.push((label ? label + ': ' : '') + content);
            }
        }
        var metadata = {
            Title: title,
            Authors: authors,
            Publication: this.text(journal, 'Title'),
            JournalAbbr: this.text(journal, 'ISOAbbreviation'),
            Volume: this.text(issue, 'Volume'),
            Issue: this.text(issue, 'Issue'),
            Pages: this.text(article, 'MedlinePgn'),
            PublishDate: this.parseDate(this.first(issue, 'PubDate')) || this.parseDate(this.first(article, 'ArticleDate')),
            Language: this.text(article, 'Language'),
            Abstract: abstracts.join('\n\n'),
            PMID: pmid,
            DOI: '',
            PMCID: ''
        };
        // Scope IDs to PubmedData so references cannot supply the article's identifiers.
        var data = this.first(record, 'PubmedData');
        var idList = this.firstChild(data, 'ArticleIdList');
        for (var id of idList ? idList.getElementsByTagName('ArticleId') : []) {
            var type = id.getAttribute('IdType');
            var value = id.textContent.trim();
            if (type === 'doi') {
                metadata.DOI = this.normalizeDOI(value);
            } else if (type === 'pmc' && /^PMC\d+$/i.test(value)) {
                metadata.PMCID = value.toUpperCase();
            }
        }
        if (!metadata.DOI) {
            for (var location of article.getElementsByTagName('ELocationID')) {
                if (location.getAttribute('EIdType') === 'doi') {
                    metadata.DOI = this.normalizeDOI(location.textContent);
                }
            }
        }
        if (!metadata.Pages) {
            for (var location of article.getElementsByTagName('ELocationID')) {
                if (location.getAttribute('EIdType') === 'pii') {
                    metadata.Pages = Utilities.normalizeWhitespace(location.textContent);
                    break;
                }
            }
        }
        return metadata;
    },

    applyIdentifiers(item, metadata) {
        return Utilities.applyExtraFields(item, { PMID: metadata.PMID, PMCID: metadata.PMCID });
    }
};
