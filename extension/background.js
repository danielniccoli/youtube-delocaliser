const REDIRECT_URL = browser.identity.getRedirectURL()
/**
 * @type {Object<string, { originalTitle: string, lastSeen: Date }>}
 * @description An object where each key is a videoId (string), and the value is an object containing:
 * - originalTitle: a string representing the original (non-localised) title
 * - lastSeen: a Date object indicating when the video was last seen
 */
const VIDEO_TITLES = {}
browser.storage.local.get("videoTitles").then((videoTitles) => Object.assign(VIDEO_TITLES, videoTitles))

class YTRequestManager {
    clientId = "627049389865-dc8cho77dpgnv3ull6mt5enpqs1g8oe0.apps.googleusercontent.com"
    tokenExpiration = null

    #token = null
    #abortController = new AbortController()

    #authInProgress = (() => {
        let resolveFn
        let state = false // TODO: When this is created clientId is null, therefore auth MUST happen first
        let promise = createPromise()

        function createPromise() {
            return new Promise(res => {
                resolveFn = () => {
                    state = false
                    res()
                }
            })
        }

        return {
            get promise() {
                return promise
            },
            get state() {
                return state
            },
            set state(state) {
                state = state
            },
            resolve() {
                resolveFn()
                promise = createPromise()
            },
        }
    })()

    #getNonce() {
        const randomBytes = new Uint8Array(16)
        crypto.getRandomValues(randomBytes)
        const nonce = randomBytes.toBase64()
        return nonce
    }

    isTokenExpired() {
        // Add a tolerance of 10 seconds.
        // Makes the access token seem to expire 10 seconds earlier,
        // than it really would.
        return (this.tokenExpiration < Date.now() + 10_000)
    }

    async #validateAccessToken(accessToken) {
        const validationURL = `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`
        let response
        try {
            response = await fetch(validationURL)
        } catch (err) {
            throw new Error("Error while validating access token", { cause: err })
        }
        if (response.status == 200) {
            browser.browserAction.setIcon({
                path: {
                    32: "icons/translate-green.svg",
                }
            })
            return true
        } else {
            browser.browserAction.setIcon({
                path: {
                    32: "icons/translate-red.svg",
                }
            })
            return false
        }
    }

    async #requestAccessToken(interactive = true) {
        const nonce = this.#getNonce()

        const scopes = ["https://www.googleapis.com/auth/youtube.readonly"]
        const auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" +
            `client_id=${this.clientId}&` +
            "response_type=token&" +
            `redirect_uri=${encodeURIComponent(REDIRECT_URL)}&` +
            `scope=${encodeURIComponent(scopes.join(' '))}&` +
            `state=${encodeURIComponent(nonce)}`

        const oAuthResponseString = await browser.identity.launchWebAuthFlow({
            interactive: interactive,
            url: auth_url
        })
        const oAuthResponse = new URL(oAuthResponseString)
        if (!oAuthResponse.hash.startsWith("#")) {
            throw new Error("Authorization response has an invalid fragment")
        }
        const searchParams = new URLSearchParams(oAuthResponse.hash.slice(1))
        if (searchParams.get("state") !== nonce) {
            throw new Error("Authorization response has an invalid state")
        }
        const accessToken = searchParams.get("access_token")
        if (!accessToken) {
            throw new Error("Authorization response has no access token")
        }
        const expiresIn = searchParams.get("expires_in")
        if (!accessToken) {
            throw new Error("Authorization response has no expiration")
        }

        return { accessToken: accessToken, expiresIn: expiresIn }
    }

    async authorize(interactive = false) {
        if (!this.clientId) {
            throw new Error("Cannot authorize without clientId")
        }
        this.#authInProgress.state = true
        this.#abortController.abort()
        this.#abortController = new AbortController()

        const { accessToken, expiresIn } = await this.#requestAccessToken(interactive)
        const isValid = await this.#validateAccessToken(accessToken)
        if (isValid) {
            this.#token = accessToken
            this.tokenExpiration = Date.now()
                + (expiresIn * 1000) // seconds to milliseconds
                - (10_000) // add 10s tolerance (early expiration)
        }
        this.#authInProgress.resolve()
    }

    async fetchOriginalTitle(id) {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}`

        // Fetch the original title, retry at most once.
        let response
        for (let attempt = 0; attempt < 2; attempt++) {
            if (this.#authInProgress.state) {
                await this.#authInProgress.promise
            }
            try {
                response = await fetch(url, {
                    headers: { Authorization: `Bearer ${this.#token}` },
                    referrer: "https://youtube.com",
                    signal: this.#abortController.signal
                })
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') {
                    // Abort signal received from another async execution of this function, which
                    // is re-authorizing. Wait until the re-authorization is completed.
                    await this.#authInProgress.promise
                    // Start a second attempt
                    continue
                } else {
                    // Any other exception is unexpected.
                    throw new Error("Error while requesting video information from YouTube", { cause: err })
                }
            }

            // Success
            if (response.status === 200) {
                const data = await response.json()
                return data.items[0].snippet.title
            }

            // YouTube API requires authorization.
            if (response.status == 401) {
                if (this.#authInProgress.state) {
                    await this.#authInProgress.promise
                } else {
                    await this.authorize()
                }
                // At this point authorisation should be complete.
                // Try another attempt to fetch the title.
                continue
            }

            throw new Error("Unknown reponse")
        }
    }
}

async function getOriginalTitle(videoId) {
    // If it's the first time this videoId is seen, create an object for it
    if (!VIDEO_TITLES.hasOwnProperty[videoId]) {
        VIDEO_TITLES[videoId] = { originalTitle: null, lastSeen: new Date() }
    }

    if (!VIDEO_TITLES[videoId].originalTitle) {
        VIDEO_TITLES[videoId].originalTitle = await api.fetchOriginalTitle(videoId)
    }

    return VIDEO_TITLES[videoId].originalTitle
}

browser.browserAction.setIcon({
    path: {
        32: "icons/translate-red.svg",
    }
})

browser.runtime.onMessage.addListener((message, sender) => {
    if (message.videoId) {
        return getOriginalTitle(message.videoId)
    }

    if (message === "authorize") {
        return api.authorize(true)
    }

    if (message === "isAuthorized") {
        return Promise.resolve(!api.isTokenExpired())
    }

    throw new Error("Received an unknown message type")
})

// Create the request manager and set the client ID.
const api = new YTRequestManager()
api.authorize()

// Open the options page after installation to allow the user to sign in with Google.
browser.runtime.onInstalled.addListener(details => {
    if (details.reason === browser.runtime.OnInstalledReason.INSTALL) {
        browser.runtime.openOptionsPage()
    }
})