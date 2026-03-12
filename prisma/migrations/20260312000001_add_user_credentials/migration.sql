-- CreateTable
CREATE TABLE "user_credentials" (
    "credential_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("credential_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_user_id_key" ON "user_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_email_key" ON "user_credentials"("email");

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
