const YTElementTypes = {
    // There are multiple HTML Elements that can hold localised video titles.
    //
    // 1. An HTMLAnchorElement with id="video-title-link" that has a child element <yt-formatted-string>.
    //    These are used on the homepage and on channel videos. For example:
    //      <a id="video-title-link" aria-label="[title] …" title="[title]" href="…[videoId]…" …>
    //          <yt-formatted-string id="video-title" …>[title]</yt-formatted-string>
    //      </a>
    //    It is not enough to just get the <yt-formatted-string> element because we also require the
    //    videoId, which is stored in the HTMLAnchorElement. 
    // 2. An HTMLAnchorElement with id="video-title" without child element.
    //    These are used on channel features. For example:
    //      <a id="video-title" aria-label="[title] …" title="[title]" href="…[videoId]…">[title]</a>
    // 3. The <yt-formatted-string> element.
    //    This is used on the video page for the main video. For example:
    //      <yt-formatted-string title="[title]" …>[title]</yt-formatted-string>
    //    We do not need the HTMLAnchorElement like above, because we know the videoId from the
    //    current web address (location.href).
    // 4. An HTMLAnchorElement with class="yt-lockup-metadata-view-model-wiz__title".
    //    These are used on the video page in the recommended section.
    //      <a class="yt-lockup-metadata-view-model-wiz__title" href="…[videoId]…" …>
    //          <span …>[title]</span>
    //      </a>
    TYPE1: "a#video-title-link:not([delocalised]):has(yt-formatted-string)",
    TYPE2: "a#video-title:not([delocalised])",
    TYPE3: "yt-formatted-string.style-scope.ytd-watch-metadata[title]:not([delocalised])",
    TYPE4: "a.yt-lockup-metadata-view-model-wiz__title:not([delocalised])",
}

function onMutation(mutationList) {
    for (const mutation of mutationList) {
        mutation.addedNodes.forEach((node) => {
            // Skip non-HTMLElement nodes.
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return
            }
            // For each node run querySelectorAll for all YTElementTypes.
            Object.keys(YTElementTypes).forEach((ytElementType) => {
                node.querySelectorAll(YTElementTypes[ytElementType]).forEach(async element => {
                    await element.setAttribute("delocalised", "") // Skips this element next time it is discovered
                    const { videoId, localisedTitle } = getVideoInfo(element, ytElementType)
                    let originalTitle
                    try {
                        originalTitle = await browser.runtime.sendMessage({ videoId: videoId })
                    } catch (err) {
                        throw new Error("Unable to get YouTube video information", { cause: err })
                    }
                    delocalise(localisedTitle, originalTitle, element, ytElementType)
                })
            })
        })
    }
}

function getVideoInfo(element, ytElementType) {
    let videoId = ""
    let localisedTitle = ""
    switch (ytElementType) {
        case "TYPE1":
        case "TYPE2": {
            videoId = new URL(element.href).searchParams.get("v")
            localisedTitle = element.title
            break
        }
        case "TYPE3": {
            videoId = new URL(location).searchParams.get("v")
            localisedTitle = element.title
            break
        }
        case "TYPE4": {
            videoId = new URL(element.href).searchParams.get("v")
            localisedTitle = element.children[0].innerText
            break
        }
        default: {
            throw new Error(
                "Invalid value for 'ytElementType'. " +
                'Expected one of "TYPE1", "TYPE2", "TYPE3" or "TYPE4".'
            )
        }
    }

    if (!videoId || !localisedTitle) {
        throw new Error("Failed to get video info from HTML elements!")
    }

    return { videoId: videoId, localisedTitle: localisedTitle }
}

function delocalise(localisedTitle, originalTitle, element, ytElementType) {
    if (localisedTitle !== originalTitle) {
        switch (ytElementType) {
            case "TYPE1": {
                element.ariaLabel.replace(localisedTitle, originalTitle)
                element.querySelector("yt-formatted-string#video-title").textContent = originalTitle
                break
            }
            case "TYPE2": {
                element.ariaLabel.replace(localisedTitle, originalTitle)
                element.title = originalTitle
                element.textContent = originalTitle
                break
            }
            case "TYPE3": {
                element.title = originalTitle
                element.textContent = originalTitle
                break
            }
            case "TYPE4": {
                element.ariaLabel.replace(localisedTitle, originalTitle)
                element.children[0].textContent = originalTitle
                break
            }
            default: {
                throw new Error(
                    "Invalid value for 'ytElementType'. " +
                    'Expected one of "TYPE1", "TYPE2", "TYPE3" or "TYPE4".'
                )
            }
        }
    }
}

const observer = new MutationObserver(onMutation)
const targetNode = document.getElementsByTagName("ytd-app")[0]
if (!targetNode) {
    throw new Error("Element <ytd-app> not found!")
}
observer.observe(targetNode, { childList: true, subtree: true })
