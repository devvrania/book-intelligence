/**
 * Whether visitors may rename and delete books and chats (and re-process finished books). Set
 * NEXT_PUBLIC_ALLOW_BOOK_CHANGES=false on a public deployment; it's inlined into the browser bundle at build time,
 * and the API enforces the same switch (assertChangesAllowed).
 */
export const allowBookChanges = process.env.NEXT_PUBLIC_ALLOW_BOOK_CHANGES !== "false";
