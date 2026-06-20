export default {
  calendar: {
    startMsg: 'Select date: (cannot pick future dates)',
  },
  btn: {
    cancel: '❌ Cancel',
    save: '✅ Save',
    categoryNotFound: '❌ Category not found',
    accountNotFound: '❌ Account not found',
  },
  common: {
    noApiKey:
      '❌ API Key not set.\n\nUse /reset to set your API Key first.',
  },
  cmd: {
    available:
      'Available commands:\n' +
        '/create - Create new transaction\n' +
        '/balance - View account balances\n' +
        '/reset - Change API Key\n' +
        '/toggle_categories - Enable/disable categories',
    start: {
      withKey:
        '👋 Welcome back!\n\n' +
          'Available commands:\n' +
          '/create - Create new transaction\n' +
          '/balance - View account balances\n' +
          '/reset - Change API Key\n' +
          '/delete - Delete API Key\n' +
          '/toggle_categories - Enable/disable categories',
      withoutKey:
        '👋 Welcome!\n\n' +
          'To get started, set your API Key with the /reset command',
    },
    balance: {
      noAccounts: '📊 No accounts found.',
      title: '💰 *Your Account Balances*',
      total: 'Total',
      error: '❌ Failed to fetch balance data.',
    },
    delete: {
      noKey: '❌ You have no stored API Key.',
      deleted: '✅ API Key successfully deleted.\n\nUse /reset to set a new API Key.',
    },
    new: {
      deprecated:
        'ℹ️  The /new command is no longer used.\nUse /create to create a new transaction.',
    },
    toggle: {
      enabled:
        '✅ Category selection *enabled*.\n\nNew transactions will ask you to pick a category.',
      disabled:
        '🔕 Category selection *disabled*.\n\nTransactions will be created without a category.',
    },
    language: {
      prompt: 'Choose language:',
      changed: '✅ Language changed to English.',
      invalid: '❌ Language not available. Choose id or en.',
    },
  },
  wizard: {
    apiKey: {
      ask:
        '🔑 Please enter your API Key:\n\n' +
          '(The API Key will be stored encrypted and used for all your transactions)',
      nonText: '❌ Please send the API Key as text.',
      saved: '✅ API Key saved successfully!\n\nUse /create to create a new transaction.',
      invalid:
        '❌ API Key is invalid or could not connect to the server.\n\n' +
          'Error: {reason}\n\nPlease try again with /reset',
    },
    transaction: {
      cancelled: '❌ Transaction cancelled.',
      askDescription: 'Transaction description? (free text)',
      askAmount: 'Transaction amount? (number)',
      invalidAmount: 'Invalid amount. Try again.',
      futureDate: '❌ Cancelled. Cannot pick a future date.',
      failedCategories: 'Failed to fetch categories from API. Try /create again.',
      failedAccounts: 'Failed to fetch accounts from API. Try /create again.',
      noAccounts: 'No accounts available. Add an account in the app first.',
      labels: {
        description: 'Description',
        nominal: 'Amount',
        date: 'Date',
        category: 'Category',
        source: 'Source',
        selectCategory: 'Select Category:',
        selectSource: 'Select Source:',
        prevBalance: 'Previous balance',
        newBalance: 'New balance',
      },
      confirm: {
        cancelled: '❌ Cancelled.',
      },
      submitted: '✅ Saved!',
      errorStatus: 'An error occurred (status {status}).',
      failedSubmit: '❌ Failed to save: {reason}',
    },
  },
};
