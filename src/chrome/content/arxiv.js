Arxiv = {
    requestQueue: Promise.resolve(),
    lastRequestTime: 0,
    requestInterval: 3000,

    requestMetadata(arxivID, reasons) {
        // arXiv permits one connection and one request every three seconds.
        var request = this.requestQueue.then(async () => {
            var wait = this.requestInterval - (Date.now() - this.lastRequestTime);
            if (wait > 0) {
                await Utilities.delay(wait);
            }
            this.lastRequestTime = Date.now();
            var url = 'https://export.arxiv.org/api/query?id_list=' + encodeURIComponent(arxivID);
            return Utilities.requestMetadataText('arXiv', url, { method: 'GET' }, reasons);
        });
        this.requestQueue = request.catch(() => {});
        return request;
    },

    generateAuthor(name) {
        if (!name) {
            return null;
        }

        var fullName = name.replace(/\s+/g, ' ').trim();
        var lastSpaceIndex = fullName.lastIndexOf(' ');
        if (lastSpaceIndex !== -1) {
            return {
                "firstName": fullName.slice(0, lastSpaceIndex).trim(),
                "lastName": fullName.slice(lastSpaceIndex + 1).trim(),
                "creatorType": "author"
            };
        }
        return { "firstName": "", "lastName": fullName, "creatorType": "author" };
    },

    generateAuthors(authorNodes) {
        var newAuthorList = [];
        if (authorNodes) {
            for (var i = 0; i < authorNodes.length; i++) {
                var nameNode = authorNodes[i].getElementsByTagName('name')[0];
                var author = nameNode ? this.generateAuthor(nameNode.textContent) : null;
                if (author) {
                    newAuthorList.push(author);
                }
            }
        }
        return newAuthorList;
    },

    generateDate(date) {
        if (!date) {
            return null;
        }
        return date.split('T')[0];
    },

    getTextContent(parent, tagName) {
        var nodes = parent.getElementsByTagName(tagName);
        if (!nodes || nodes.length === 0) {
            return null;
        }
        return Utilities.decodeHTMLEntities(Utilities.normalizeWhitespace(nodes[0].textContent));
    },

    getArxivTextContent(parent, localName) {
        var nodes = parent.getElementsByTagNameNS('http://arxiv.org/schemas/atom', localName);
        if (!nodes || nodes.length === 0) {
            nodes = parent.getElementsByTagName('arxiv:' + localName);
        }
        if (!nodes || nodes.length === 0) {
            return null;
        }
        return Utilities.decodeHTMLEntities(Utilities.normalizeWhitespace(nodes[0].textContent));
    },

    getArxivAttribute(parent, localName, attributeName) {
        var nodes = parent.getElementsByTagNameNS('http://arxiv.org/schemas/atom', localName);
        if (!nodes || nodes.length === 0) {
            nodes = parent.getElementsByTagName('arxiv:' + localName);
        }
        if (!nodes || nodes.length === 0) {
            return null;
        }
        return nodes[0].getAttribute(attributeName);
    },

    normalizeArxivID(value) {
        if (!value) {
            return null;
        }
        var text = Utilities.normalizeWhitespace(value);
        var match = text.match(/(?:arxiv\s*(?:id)?\s*[:：]\s*)?((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)/i);
        return match ? match[1] : null;
    },

    getArxivIDFromDOI(value) {
        var match = PubMed.normalizeDOI(value).match(/^10\.48550\/arxiv\.(.+)$/i);
        var id = match ? this.normalizeArxivID(match[1]) : null;
        return id && id === match[1] ? id : null;
    },

    getArxivID(item) {
        var archiveID = item.getField('archiveID');
        var arxivID = this.normalizeArxivID(archiveID);
        if (arxivID) {
            return arxivID;
        }

        var url = item.getField('url');
        if (url) {
            var urlMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#.]+(?:\.\d+)?(?:v\d+)?)/i);
            if (urlMatch) {
                return this.normalizeArxivID(urlMatch[1]);
            }
        }

        var extra = item.getField('extra');
        arxivID = this.normalizeArxivID(extra);
        if (arxivID) {
            return arxivID;
        }

        arxivID = this.getArxivIDFromDOI(item.getField('DOI')) || this.getArxivIDFromDOI(url);
        if (arxivID) {
            return arxivID;
        }

        return null;
    },

    async getMetaData(item, reasons) {
        var arxivID = this.getArxivID(item);
        if (!arxivID) {
            return Utilities.lookupFailure(reasons, 'arXiv: missing arXiv identifier', false);
        }
        try {
            var metadata = await this.getAtomMetaData(arxivID, reasons);
            if (metadata) {
                return metadata;
            }
        } catch (error) {
            reasons?.add('arXiv: ' + error);
        }
        try {
            return await this.getDOIMetaData(item, arxivID, reasons);
        } catch (error) {
            return Utilities.lookupFailure(reasons, 'arXiv DOI: ' + error);
        }
    },

    async getDOIMetaData(item, arxivID, reasons) {
        // The DOI describes the latest version; require a match for a pinned v1/v2/etc.
        var version = arxivID.match(/v(\d+)$/i);
        var doi = '10.48550/arXiv.' + arxivID.replace(/v\d+$/i, '');
        var text = await Utilities.requestMetadataText('arXiv DOI', 'https://doi.org/' + doi, {
            method: 'GET', headers: new Headers({ Accept: 'application/vnd.citationstyles.csl+json' })
        }, reasons);
        var data = Utilities.parseJsonOrNull(text, 'arXiv DOI', reasons);
        if (!data) return null;
        if (!data.title || PubMed.normalizeDOI(data.DOI).toLowerCase() !== doi.toLowerCase()) {
            return Utilities.lookupFailure(reasons, 'arXiv DOI: missing title or requested DOI in response');
        }
        if (version && String(data.version) !== version[1]) {
            return Utilities.lookupFailure(reasons, 'arXiv DOI: response does not match requested version v' + version[1], false);
        }
        var date = Journal.getPublicationDate(data);
        var existingDate = item.getField('date') || '';
        // DataCite may supply only a year; keep an existing date with finer precision.
        if (date && /^\d{4}$/.test(date) && existingDate.startsWith(date + '-')) {
            date = '';
        }
        return {
            Title: Journal.generateTitle(data),
            Authors: Journal.generateAuthors(data.author),
            PublishDate: date || '',
            Abstract: Utilities.normalizeWhitespace(data.abstract || ''),
            DOI: item.getField('DOI') ? '' : doi,
            Repository: 'arXiv',
            ArchiveID: 'arXiv:' + arxivID,
            URL: 'https://arxiv.org/abs/' + arxivID
        };
    },

    getAtomMetaData(arxivID, reasons) {
        return this.requestMetadata(arxivID, reasons)
            .then(data => {
                if (!data) {
                    return null;
                }
                try {
                    var parser = new DOMParser();
                    var xmlDoc = parser.parseFromString(data, "application/xml");
                    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
                        return Utilities.lookupFailure(reasons, 'arXiv: invalid Atom XML response');
                    }
                    var entry = xmlDoc.getElementsByTagName('entry')[0];
                    if (!entry) {
                        return Utilities.lookupFailure(reasons, 'arXiv: no entry returned for ' + arxivID);
                    }
                    var returnedID = this.normalizeArxivID(this.getTextContent(entry, 'id'));
                    if (!returnedID || returnedID.replace(/v\d+$/i, '') !== arxivID.replace(/v\d+$/i, '') ||
                        (/v\d+$/i.test(arxivID) && returnedID !== arxivID)) {
                        return Utilities.lookupFailure(reasons, 'arXiv: entry does not match requested identifier ' + arxivID);
                    }

                    var Title = this.getTextContent(entry, 'title');
                    if (!Title) {
                        return Utilities.lookupFailure(reasons, 'arXiv: entry missing title');
                    }
                    var Authors = this.generateAuthors(entry.getElementsByTagName('author'));
                    var PublishDate = this.generateDate(this.getTextContent(entry, 'published'));
                    var Abstract = this.getTextContent(entry, 'summary');
                    var JournalRef = this.getArxivTextContent(entry, 'journal_ref');
                    var DOI = this.getArxivTextContent(entry, 'doi');
                    var Category = this.getArxivAttribute(entry, 'primary_category', 'term');

                    return {
                        "Title": Title ? Title : "",
                        "Authors": Authors ? Authors : "",
                        "PublishDate": PublishDate ? PublishDate : "",
                        "Abstract": Abstract ? Abstract : "",
                        "JournalRef": JournalRef ? JournalRef : "",
                        "DOI": DOI ? DOI : "",
                        "Repository": "arXiv",
                        "ArchiveID": "arXiv:" + arxivID,
                        "URL": "https://arxiv.org/abs/" + arxivID,
                        "Category": Category ? Category : ""
                    };
                } catch (error) {
                    return Utilities.lookupFailure(reasons, 'arXiv: could not read Atom entry: ' + error);
                }
            });
    },

    async updateMetadata(item, reasons) {
        var metaData = await this.getMetaData(item, reasons);
        if (!metaData) {
            return 1;
        }

        var changed = Utilities.applyMetadata(item, metaData, {
            "Title": "title",
            "Authors": "creators",
            "PublishDate": "date",
            "Abstract": "abstractNote",
            "DOI": "DOI",
            "Repository": "repository",
            "ArchiveID": "archiveID",
            "URL": "url"
        });
        // A preprint has no publicationTitle. Preserve arXiv's free-form citation in Extra.
        changed = Utilities.applyExtraFields(item, { 'arXiv journal ref': metaData.JournalRef }) || changed;
        if (!changed) {
            reasons?.add('arXiv: no applicable fields in returned metadata');
            return 1;
        }
        await Utilities.saveItemTx(item);
        return 0;
    }
};
