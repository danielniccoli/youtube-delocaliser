const clientIdElement = document.getElementById("client-id")

async function updateSignInButtonText() {
    browser.runtime.sendMessage("isAuthorized").then(response => {
        let signInButtonText
        if (response) {
            signInButtonText = "Already signed in"
        } else {
            signInButtonText = "Continue with Google"
        }
        document.getElementsByName("authorise-text").forEach(node => {
            node.textContent = signInButtonText
        })
    })
}

document.getElementById("google-sign-in-button").addEventListener("click", async (e) => {
    await browser.runtime.sendMessage("authorize")
    updateSignInButtonText()
})

updateSignInButtonText()