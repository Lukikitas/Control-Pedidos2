import asyncio
from playwright.async_api import async_playwright, expect
import os

async def run_simple_test():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Manually set up the view
        file_path = os.path.abspath('index.html')
        await page.goto(f'file://{file_path}')
        await page.locator('#login-view').evaluate('(element) => element.classList.add("hidden")')
        await page.locator('#role-selection-view').evaluate('(element) => element.classList.add("hidden")')
        await page.locator('#main-view').evaluate('(element) => element.classList.remove("hidden")')
        await page.locator('#operator-view').evaluate('(element) => element.classList.remove("hidden")')

        # Set some initial state for sessionData and other globals the functions need
        await page.evaluate("""() => {
            window.sessionData = { codes: [], history: [] };
            window.closeOrdersView = document.getElementById('closeorders-view');
            window.activeFilter = 'all';
            window.userSettings = { blinkMinutes: 10, criticalMinutes: 20 };
            window.showNotification = (msg, type) => console.log(`NOTIFY: ${msg} (${type})`);
        }""")

        # Add an item
        await page.evaluate("() => addCode('5678', 'Rappi')")
        await page.screenshot(path="jules-scratch/verification/optimistic_add.png")

        # Get the ID and delete
        new_item_div = page.locator('.flex.items-center.justify-between', has_text='5678')
        delete_button = new_item_div.locator('.delete-btn')
        item_id = await delete_button.get_attribute('data-id')
        await page.evaluate(f"id => deleteCode(id)", item_id)
        await page.screenshot(path="jules-scratch/verification/optimistic_delete.png")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(run_simple_test())
