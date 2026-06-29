-- CreateTable
CREATE TABLE "conversation_summaries" (
    "summary_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("summary_id")
);

-- CreateIndex
CREATE INDEX "conversation_summaries_review_id_idx" ON "conversation_summaries"("review_id");

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;
