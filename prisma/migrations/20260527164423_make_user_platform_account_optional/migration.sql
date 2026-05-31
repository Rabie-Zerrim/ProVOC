-- DropForeignKey
ALTER TABLE "review_platform_posts" DROP CONSTRAINT "review_platform_posts_user_platform_account_id_fkey";

-- AlterTable
ALTER TABLE "review_platform_posts" ALTER COLUMN "user_platform_account_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "review_platform_posts" ADD CONSTRAINT "review_platform_posts_user_platform_account_id_fkey" FOREIGN KEY ("user_platform_account_id") REFERENCES "user_platform_accounts"("account_id") ON DELETE SET NULL ON UPDATE CASCADE;
