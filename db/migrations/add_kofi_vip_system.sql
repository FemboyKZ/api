-- Migration: Ko-fi donation/shop tracking + VIP tier system
--
-- One combined migration covering:
--   * kofi_transactions      - Ko-fi webhook ledger (payments, EUR, claim state)
--   * player_meta extensions - verified email, lifetime EUR spend, gift tokens
--   * player_email_verifications - pending email verification tokens (hashed)
--   * player_contact_history - audit of linked/unlinked email & discord
--   * pending_gifts          - gifts to an unregistered email/SteamID
--
-- Tiers are spend-driven (lifetime EUR, one-time, no expiry):
--   VIP €10 | VIP+ €20 (+1 gift token) | VIP++ €25 (+1 gift token)
--   custom Discord role €40 | custom in-game tag €50
--
-- Assumes player_meta already exists (see add_player_meta.sql).
-- Apply: mysql -u user -p database < db/migrations/add_kofi_vip_system.sql

-- ---------------------------------------------------------------------------
-- Ko-fi transactions ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kofi_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(64) NOT NULL COMMENT 'Ko-fi message_id (uuid) - idempotent dedupe',
    kofi_transaction_id VARCHAR(64) DEFAULT NULL COMMENT 'Ko-fi internal transaction id',
    type VARCHAR(32) NOT NULL COMMENT 'Tip | Subscription | Commission | Shop Order',
    from_name VARCHAR(255) DEFAULT NULL,
    email VARCHAR(255) DEFAULT NULL COMMENT 'Buyer email from Ko-fi (private)',
    message TEXT DEFAULT NULL COMMENT 'Buyer message/note (may contain SteamID)',
    is_public BOOLEAN DEFAULT FALSE COMMENT 'If false, hide message on public displays',
    amount DECIMAL(10,2) DEFAULT 0,
    amount_eur DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'amount converted to EUR at processing time',
    currency VARCHAR(8) DEFAULT NULL,
    is_subscription_payment BOOLEAN DEFAULT FALSE,
    is_first_subscription_payment BOOLEAN DEFAULT FALSE,
    tier_name VARCHAR(255) DEFAULT NULL COMMENT 'Membership tier (subscriptions)',
    shop_items JSON DEFAULT NULL COMMENT 'Array of {direct_link_code, variation_name, quantity}',
    url VARCHAR(512) DEFAULT NULL,
    steamid VARCHAR(20) DEFAULT NULL COMMENT 'Resolved buyer SteamID64, NULL if unmatched',
    status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'resolution: pending | matched | ignored',
    claim_status VARCHAR(16) NOT NULL DEFAULT 'unclaimed' COMMENT 'unclaimed | claimed | gifted',
    beneficiary_steamid VARCHAR(20) DEFAULT NULL COMMENT 'SteamID credited (self or gift recipient)',
    claimed_at TIMESTAMP NULL DEFAULT NULL,
    kofi_timestamp TIMESTAMP NULL DEFAULT NULL COMMENT 'Ko-fi event timestamp',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_message (message_id),
    INDEX idx_steamid (steamid),
    INDEX idx_status (status),
    INDEX idx_claim_status (claim_status),
    INDEX idx_beneficiary (beneficiary_steamid),
    INDEX idx_type (type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- player_meta extensions: contact email + spend totals + gift tokens
-- email is UNIQUE (one email -> one account) to block VIP farming via re-link.
-- MySQL UNIQUE permits multiple NULLs, so unlinked players are unaffected.
-- ---------------------------------------------------------------------------
ALTER TABLE player_meta
  ADD COLUMN email VARCHAR(255) DEFAULT NULL COMMENT 'Verified contact email (lowercased), private',
  ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When email was verified',
  ADD COLUMN total_spent_eur DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Lifetime EUR credited (claimed + gifted-in)',
  ADD COLUMN gift_tokens INT NOT NULL DEFAULT 0 COMMENT 'Available VIP gift tokens to redeem to others',
  ADD COLUMN gift_tokens_granted INT NOT NULL DEFAULT 0 COMMENT 'Lifetime gift tokens granted (prevents re-grant)',
  ADD UNIQUE KEY uniq_email (email);

-- ---------------------------------------------------------------------------
-- Pending email verifications (raw token returned once; only hash stored)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_email_verifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL COMMENT 'Email being verified (lowercased)',
    token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 hex of the verification token',
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When the token was used (null = unused)',
    attempts INT NOT NULL DEFAULT 0 COMMENT 'Failed verify attempts against this record',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_token (token_hash),
    INDEX idx_steamid (steamid),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Contact history: every email/discord linked/replaced/unlinked/blocked.
-- Used to detect abuse (same contact across many SteamIDs). PRIVATE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_contact_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    type VARCHAR(16) NOT NULL COMMENT 'email | discord',
    value VARCHAR(255) NOT NULL COMMENT 'The email or discord_id (lowercased for email)',
    action VARCHAR(16) NOT NULL COMMENT 'linked | unlinked | replaced | blocked',
    note VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_steamid (steamid),
    INDEX idx_value (value),
    INDEX idx_type_value (type, value),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Gifts targeted at an as-yet-unregistered email/SteamID (redeemed on link)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_gifts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kind VARCHAR(16) NOT NULL COMMENT 'credit (adds EUR to total) | vip (grants base VIP only)',
    target_type VARCHAR(16) NOT NULL DEFAULT 'email' COMMENT 'email | steamid',
    target_value VARCHAR(255) NOT NULL COMMENT 'email (lowercased) or SteamID64',
    amount_eur DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'EUR credited (kind=credit)',
    source_steamid VARCHAR(20) DEFAULT NULL COMMENT 'Gifter SteamID',
    source_transaction_id BIGINT DEFAULT NULL COMMENT 'Originating kofi_transactions.id',
    redeemed_steamid VARCHAR(20) DEFAULT NULL,
    redeemed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_value),
    INDEX idx_redeemed (redeemed_at),
    INDEX idx_source (source_steamid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
