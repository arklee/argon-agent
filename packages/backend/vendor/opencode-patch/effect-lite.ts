/**
 * The small part of `effect` that the vendored opencode patch.ts uses (`Result`, `Schema.TaggedError`),
 * so Argon does not depend on effect. Same shapes as effect's: `Result` is `{ _tag: "Success", success }`
 * or `{ _tag: "Failure", failure }`, and a tagged error is an Error with `_tag` and its fields.
 */

type Success<A> = { readonly _tag: "Success"; readonly success: A };
type Failure<E> = { readonly _tag: "Failure"; readonly failure: E };

export declare namespace Result {
	type Result<A, E> = Success<A> | Failure<E>;
}

export const Result = {
	succeed: <A>(success: A): Success<A> => ({ _tag: "Success", success }),
	fail: <E>(failure: E): Failure<E> => ({ _tag: "Failure", failure }),
	isFailure: <A, E>(result: Result.Result<A, E>): result is Failure<E> => result._tag === "Failure",
};

/** A field declaration; only its type matters here (no runtime validation). */
interface Field<T, Optional extends boolean = false> {
	readonly type?: T;
	readonly optional: Optional;
}

type Required<F> = { [K in keyof F as F[K] extends Field<unknown, false> ? K : never]: FieldType<F[K]> };
type Optional<F> = { [K in keyof F as F[K] extends Field<unknown, true> ? K : never]?: FieldType<F[K]> };
type FieldType<F> = F extends Field<infer T, boolean> ? T : never;
type Props<F> = Required<F> & Optional<F>;

const field = <T>(): Field<T> => ({ optional: false });

export const Schema = {
	String: field<string>(),
	Number: field<number>(),
	Literals: <const L extends readonly string[]>(_literals: L): Field<L[number]> => field<L[number]>(),
	optional: <T>(_field: Field<T>): Field<T, true> => ({ optional: true }),
	/** `class X extends Schema.TaggedError<X>()("Tag", { ...fields }) {}` */
	TaggedError:
		<_Self>() =>
		<Tag extends string, F extends Record<string, Field<unknown, boolean>>>(tag: Tag, _fields: F) =>
			class extends Error {
				readonly _tag: Tag = tag;
				constructor(props: Props<F>) {
					// No message argument: subclasses define `message` as a getter, which an own property would hide.
					super();
					Object.assign(this, props);
				}
			} as unknown as new (
				props: Props<F>,
			) => Error & { readonly _tag: Tag } & Readonly<Props<F>>,
};
