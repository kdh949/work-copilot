import type { ChangeEvent, FormEvent, ReactNode } from "react";

type PracticeCardProps = {
    title: string;
    children: ReactNode;
};

function PracticeCard(props: PracticeCardProps) {
    return (
        <section className="parctice-card">
            <h3>{props.title}</h3>

            <div>{props.children}</div>
        </section>
    );
}

export function PracticePanel() {
    function handleButtonClick() {
        alert('버튼을 클릭했습니다.');
    }

    function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
        console.log(event.target.value);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); // 브라우저의 기본 동작을 막음 (여기서는 새로고침 방지용으로 사용)

        alert('폼 제출 이벤트가 발생했습니다.');
    }

    return (
        <section>
            <PracticeCard title="props와 children 연습">
                <p>이 문장은 PracticeCard의 children으로 전달됩니다.</p>
            </PracticeCard>

            <PracticeCard title="이벤트 연습">
                <button type="button" onClick={handleButtonClick}>
                    버튼 클릭
                </button>

                <form onSubmit={handleSubmit}> {/*// form이 제출되면 handleSubmit 함수 실행*/}
                    <input
                        name="email"
                        type="email"
                        placeholder="이메일을 입력하세요"
                        onChange={handleInputChange} // onChange: 값이 바뀔 때 실행할 함수
                    />

                    <button type="submit">제출</button>
                </form>
            </PracticeCard>
        </section>
    );
}
