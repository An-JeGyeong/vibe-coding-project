package com.mangabridge.bootstrap.translatedpage;

import static org.assertj.core.api.Assertions.*;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class TranslationPageBodyLimitTest {
    @Test void oversizedContentLengthIsRejectedBeforeOpeningStream() {
        var reads=new AtomicInteger();var request=new MockHttpServletRequest(){
            @Override public long getContentLengthLong(){return TranslationPageService.MAX_BYTES+1L;}
            @Override public ServletInputStream getInputStream(){reads.incrementAndGet();throw new AssertionError("Body must not be opened");}
        };request.setContentType("image/png");assertInvalid(()->TranslationPageController.readBounded(request));assertThat(reads).hasValue(0);
    }
    @Test void unknownLengthChunkedUploadReadsAtMostLimitPlusOneRatherThanWholeBody() {
        var read=new AtomicInteger();var request=new MockHttpServletRequest(){
            @Override public long getContentLengthLong(){return -1;}
            @Override public ServletInputStream getInputStream(){return new ServletInputStream(){
                @Override public int read(){read.incrementAndGet();return 1;}
                @Override public int read(byte[] bytes,int offset,int length){read.addAndGet(length);java.util.Arrays.fill(bytes,offset,offset+length,(byte)1);return length;}
                @Override public boolean isFinished(){return false;}
                @Override public boolean isReady(){return true;}
                @Override public void setReadListener(ReadListener listener){}
            };}
        };request.setContentType("image/png");assertInvalid(()->TranslationPageController.readBounded(request));assertThat(read).hasValue(TranslationPageService.MAX_BYTES+1);
    }
    @Test void magicValidationAndImageToStringDoNotExposeBytes() {
        assertInvalid(()->TranslationPageService.validateImage("image/png",new byte[7]));assertInvalid(()->TranslationPageService.validateImage("image/jpeg",new byte[2]));assertInvalid(()->TranslationPageService.validateImage("image/webp",new byte[11]));
        assertThat(new com.mangabridge.bootstrap.page.PageModels.Image("image/png",new byte[]{1,2,3}).toString()).isEqualTo("Image[redacted]");
    }
    private void assertInvalid(org.assertj.core.api.ThrowableAssert.ThrowingCallable call){assertThatThrownBy(call).isInstanceOfSatisfying(TranslationPageFailure.class,e->{assertThat(e.status).isEqualTo(400);assertThat(e.code).isEqualTo("INVALID_REQUEST");});}
}
