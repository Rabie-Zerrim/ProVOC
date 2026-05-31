-- CreateTable
CREATE TABLE "review_chat_messages" (
    "message_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_chat_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE INDEX "review_chat_messages_review_id_idx" ON "review_chat_messages"("review_id");

-- AddForeignKey
ALTER TABLE "review_chat_messages" ADD CONSTRAINT "review_chat_messages_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;
