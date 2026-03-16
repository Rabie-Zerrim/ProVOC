-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'fr',
    "age_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "pref_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "default_tone" TEXT,
    "preferred_networks" JSONB,
    "review_reminder_delay" INTEGER,
    "location_tracking" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("pref_id")
);

-- CreateTable
CREATE TABLE "data_consent" (
    "consent_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_type" TEXT NOT NULL,
    "is_given" BOOLEAN NOT NULL DEFAULT false,
    "given_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "version" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_consent_pkey" PRIMARY KEY ("consent_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "permission_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_perm_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_perm_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_role_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_role_id")
);

-- CreateTable
CREATE TABLE "user_activity_stats" (
    "stat_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reputation_score" INTEGER NOT NULL DEFAULT 0,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "most_reviewed_category" TEXT,
    "total_arbitrations" INTEGER NOT NULL DEFAULT 0,
    "last_calculated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_activity_stats_pkey" PRIMARY KEY ("stat_id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "business_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "parent_business_id" UUID,
    "business_type" TEXT,
    "is_online_only" BOOLEAN NOT NULL DEFAULT false,
    "is_claimed" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "public_page_slug" TEXT,
    "qr_code_url" TEXT,
    "avg_rating" DECIMAL(3,2),
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "address" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "listings" (
    "listing_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "network_id" UUID NOT NULL,
    "external_listing_id" TEXT,
    "external_rating" DECIMAL(3,2),
    "external_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "networks" (
    "network_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "base_url" TEXT,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "networks_pkey" PRIMARY KEY ("network_id")
);

-- CreateTable
CREATE TABLE "network_preferences" (
    "network_pref_id" UUID NOT NULL,
    "network_id" UUID NOT NULL,
    "max_chars_post" INTEGER,
    "min_chars_post" INTEGER,
    "rating_type" TEXT NOT NULL,
    "rating_scale_min" INTEGER NOT NULL DEFAULT 1,
    "rating_scale_max" INTEGER NOT NULL DEFAULT 5,
    "rating_options" JSONB,
    "has_profanity_filter" BOOLEAN NOT NULL DEFAULT false,
    "supports_api_posting" BOOLEAN NOT NULL DEFAULT false,
    "post_auth_type" TEXT,
    "requires_verified_account" BOOLEAN NOT NULL DEFAULT false,
    "allows_media_in_review" BOOLEAN NOT NULL DEFAULT false,
    "max_media_count" INTEGER,
    "supports_update_review" BOOLEAN NOT NULL DEFAULT false,
    "supports_delete_review" BOOLEAN NOT NULL DEFAULT false,
    "max_chars_reply" INTEGER,
    "min_chars_reply" INTEGER,
    "supports_api_reply" BOOLEAN NOT NULL DEFAULT false,
    "reply_auth_type" TEXT,
    "reply_requires_ownership" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_preferences_pkey" PRIMARY KEY ("network_pref_id")
);

-- CreateTable
CREATE TABLE "user_platform_accounts" (
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "network_id" UUID NOT NULL,
    "oauth_token" TEXT,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "external_user_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_platform_accounts_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "review_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "listing_id" UUID,
    "review_text" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "tone" TEXT,
    "intent" TEXT,
    "language" VARCHAR(10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("review_id")
);

-- CreateTable
CREATE TABLE "review_medias" (
    "media_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "media_type" TEXT,
    "s3_key" TEXT NOT NULL,
    "original_filename" TEXT,
    "file_size_bytes" INTEGER,
    "mime_type" TEXT,
    "thumbnail_url" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_medias_pkey" PRIMARY KEY ("media_id")
);

-- CreateTable
CREATE TABLE "review_histories" (
    "history_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "previous_status" TEXT,
    "new_status" TEXT NOT NULL,
    "snapshot_text" TEXT,
    "changed_by_type" TEXT,
    "changed_by_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_histories_pkey" PRIMARY KEY ("history_id")
);

-- CreateTable
CREATE TABLE "review_drafts" (
    "draft_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "network_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "draft_text" TEXT NOT NULL,
    "compliance_check" BOOLEAN NOT NULL DEFAULT true,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_drafts_pkey" PRIMARY KEY ("draft_id")
);

-- CreateTable
CREATE TABLE "review_platform_posts" (
    "post_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "network_id" UUID NOT NULL,
    "listing_id" UUID,
    "user_platform_account_id" UUID NOT NULL,
    "external_review_id" TEXT,
    "status" TEXT NOT NULL,
    "platform_specific_text" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_platform_posts_pkey" PRIMARY KEY ("post_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "title" VARCHAR(255),
    "body" TEXT,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_sent" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "scheduled_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("notification_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_activity_stats_user_id_key" ON "user_activity_stats"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_public_page_slug_key" ON "businesses"("public_page_slug");

-- CreateIndex
CREATE UNIQUE INDEX "network_preferences_network_id_key" ON "network_preferences"("network_id");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent" ADD CONSTRAINT "data_consent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_activity_stats" ADD CONSTRAINT "user_activity_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_parent_business_id_fkey" FOREIGN KEY ("parent_business_id") REFERENCES "businesses"("business_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("network_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_preferences" ADD CONSTRAINT "network_preferences_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("network_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_platform_accounts" ADD CONSTRAINT "user_platform_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_platform_accounts" ADD CONSTRAINT "user_platform_accounts_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("network_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_medias" ADD CONSTRAINT "review_medias_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_histories" ADD CONSTRAINT "review_histories_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_drafts" ADD CONSTRAINT "review_drafts_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_drafts" ADD CONSTRAINT "review_drafts_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("network_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_platform_posts" ADD CONSTRAINT "review_platform_posts_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_platform_posts" ADD CONSTRAINT "review_platform_posts_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("network_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_platform_posts" ADD CONSTRAINT "review_platform_posts_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_platform_posts" ADD CONSTRAINT "review_platform_posts_user_platform_account_id_fkey" FOREIGN KEY ("user_platform_account_id") REFERENCES "user_platform_accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
