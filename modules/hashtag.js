function getHashTags(inputText) {
    const regex = /(^|\B)#(?![0-9_-]+\b)([a-zA-Z0-9_\-/]{1,30})(\b|\r)/g;
    var matches = [];
    var match, splitted;

    while ((match = regex.exec(inputText))) {
        splitted = match[2].split('/'); // Find parameters
        matches.push(splitted);
    }

    return matches;
}

module.exports = getHashTags;
